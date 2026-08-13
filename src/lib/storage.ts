import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/lib/config';
import { AppError } from '@/lib/errors';

export const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const allowedTypes = new Set(['image/png', 'image/jpeg', 'application/pdf']);

export function validateProof(file: { type: string; size: number; bytes: Buffer }): { checksum: string } {
  if (!allowedTypes.has(file.type)) throw new AppError(400, 'Only PNG, JPEG, and PDF proof files are accepted', 'INVALID_FILE_TYPE');
  if (file.size <= 0 || file.size > MAX_PROOF_BYTES) throw new AppError(400, 'Proof file must be smaller than 10 MB', 'INVALID_FILE_SIZE');
  const magic = file.bytes.subarray(0, 8);
  const matches = file.type === 'image/png' ? magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4e && magic[3] === 0x47
    : file.type === 'image/jpeg' ? magic[0] === 0xff && magic[1] === 0xd8
      : file.bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (!matches) throw new AppError(400, 'File content does not match its declared type', 'INVALID_FILE_CONTENT');
  return { checksum: createHash('sha256').update(file.bytes).digest('hex') };
}

function client(): S3Client {
  if (!env.s3Endpoint || !env.s3Bucket || !env.s3AccessKeyId || !env.s3SecretAccessKey) throw new AppError(503, 'Private proof storage is not configured', 'STORAGE_UNAVAILABLE');
  return new S3Client({ endpoint: env.s3Endpoint, region: env.s3Region, forcePathStyle: true, credentials: { accessKeyId: env.s3AccessKeyId, secretAccessKey: env.s3SecretAccessKey } });
}

export async function putPrivateProof(key: string, bytes: Buffer, mimeType: string, checksum: string): Promise<void> {
  if (env.proofStorageMode === 'memory') return;
  await client().send(new PutObjectCommand({ Bucket: env.s3Bucket, Key: key, Body: bytes, ContentType: mimeType, ChecksumSHA256: Buffer.from(checksum, 'hex').toString('base64'), ServerSideEncryption: 'AES256' }));
}

export async function scanProof(bytes: Buffer, mimeType: string): Promise<void> {
  if (!env.malwareScannerUrl) {
    if (env.malwareScanRequired) throw new AppError(503, 'Malware scanning is not configured', 'MALWARE_SCAN_UNAVAILABLE');
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.malwareScannerTimeoutMs);
  try {
    const response = await fetch(env.malwareScannerUrl, { method: 'POST', headers: { 'content-type': mimeType, 'x-file-sha256': createHash('sha256').update(bytes).digest('hex') }, body: bytes as unknown as BodyInit, signal: controller.signal });
    if (!response.ok) throw new AppError(503, 'Malware scanner rejected the upload', 'MALWARE_SCAN_FAILED');
    const result = await response.json() as { clean?: boolean };
    if (result.clean !== true) throw new AppError(400, 'Proof file failed malware scanning', 'MALWARE_DETECTED');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'Malware scanner is unavailable', 'MALWARE_SCAN_UNAVAILABLE');
  } finally { clearTimeout(timeout); }
}

export async function signedProofUrl(key: string): Promise<string> {
  if (env.proofStorageMode === 'memory') throw new AppError(404, 'Local test proofs are not persisted for download', 'LOCAL_PROOF_NOT_PERSISTED');
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }), { expiresIn: env.s3SignedUrlTtlSeconds });
}
