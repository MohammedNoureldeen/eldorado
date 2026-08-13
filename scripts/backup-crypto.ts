import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const magic = Buffer.from('ELDBKP01');

function encryptionKey(): Buffer {
  const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY ?? '', 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return key;
}

async function encrypt(input: string, output: string): Promise<void> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const destination = createWriteStream(output, { flags: 'wx' });
  destination.write(Buffer.concat([magic, iv]));
  cipher.pipe(destination, { end: false });
  await pipeline(createReadStream(input), cipher);
  destination.end(cipher.getAuthTag());
  await new Promise<void>((resolve, reject) => { destination.on('finish', resolve); destination.on('error', reject); });
}

async function decrypt(input: string, output: string): Promise<void> {
  const handle = await fs.open(input, 'r');
  const stat = await handle.stat();
  if (stat.size < magic.length + 12 + 16) throw new Error('Encrypted backup is truncated');
  const header = Buffer.alloc(magic.length + 12);
  const tag = Buffer.alloc(16);
  await handle.read(header, 0, header.length, 0);
  await handle.read(tag, 0, tag.length, stat.size - tag.length);
  await handle.close();
  if (!header.subarray(0, magic.length).equals(magic)) throw new Error('Encrypted backup header is invalid');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), header.subarray(magic.length));
  decipher.setAuthTag(tag);
  await pipeline(createReadStream(input, { start: header.length, end: stat.size - tag.length - 1 }), decipher, createWriteStream(output, { flags: 'wx' }));
}

async function main() {
  const [mode, input, output] = process.argv.slice(2);
  if (!input || !output || !['encrypt', 'decrypt'].includes(mode)) throw new Error('Usage: backup-crypto <encrypt|decrypt> <input> <output>');
  if (mode === 'encrypt') await encrypt(input, output); else await decrypt(input, output);
  console.log(`${mode} completed: ${output}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
