import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env, parseCredentialKeys } from '@/lib/config';

function activeKey(): { version: string; key: Buffer } {
  const keys = parseCredentialKeys();
  const key = keys.get(env.credentialActiveKeyVersion);
  if (!key) throw new Error('No active credential encryption key is configured');
  return { version: env.credentialActiveKeyVersion, key };
}

export function encryptSecret(value: string, version = activeKey().version): string {
  const key = parseCredentialKeys().get(version);
  if (!key) throw new Error(`Credential encryption key ${version} is not configured`);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [version, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(packed: string): string {
  const [version, ivEncoded, tagEncoded, ciphertextEncoded] = packed.split('.');
  if (!version || !ivEncoded || !tagEncoded || !ciphertextEncoded) throw new Error('Invalid encrypted secret');
  const key = parseCredentialKeys().get(version);
  if (!key) throw new Error(`Credential encryption key ${version} is not configured`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivEncoded, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, 'base64url')), decipher.final()]).toString('utf8');
}

export function encryptCredentialSet(credentials: { email: string; password: string; backupCodes?: string[] }): { emailCiphertext: string; passwordCiphertext: string; backupCodesCiphertext: string | null; keyVersion: string } {
  const { version } = activeKey();
  return {
    emailCiphertext: encryptSecret(credentials.email, version),
    passwordCiphertext: encryptSecret(credentials.password, version),
    backupCodesCiphertext: credentials.backupCodes?.length ? encryptSecret(JSON.stringify(credentials.backupCodes), version) : null,
    keyVersion: version
  };
}

export function decryptCredentialSet(input: { emailCiphertext?: string | null; passwordCiphertext?: string | null; backupCodesCiphertext?: string | null }): { email: string; password: string; backupCodes: string[] } {
  if (!input.emailCiphertext || !input.passwordCiphertext) throw new Error('Credentials have been deleted');
  return {
    email: decryptSecret(input.emailCiphertext),
    password: decryptSecret(input.passwordCiphertext),
    backupCodes: input.backupCodesCiphertext ? JSON.parse(decryptSecret(input.backupCodesCiphertext)) as string[] : []
  };
}
