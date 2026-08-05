const production = process.env.NODE_ENV === 'production';

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL ?? '',
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'eldorado_session',
  sessionCookieSecret: process.env.SESSION_COOKIE_SECRET ?? (production ? '' : 'development-only-change-me-development-only-change-me'),
  sessionTtlDays: numberEnv('SESSION_TTL_DAYS', 7),
  credentialKeys: process.env.CREDENTIAL_ENCRYPTION_KEYS ?? '',
  credentialActiveKeyVersion: process.env.CREDENTIAL_ACTIVE_KEY_VERSION ?? 'v1',
  futBaseUrl: process.env.FUT_BASE_URL ?? '',
  futApiKey: process.env.FUT_API_KEY ?? '',
  futApiSecret: process.env.FUT_API_SECRET ?? '',
  futTimeoutMs: numberEnv('FUT_TIMEOUT_MS', 8000),
  futMaxRetries: numberEnv('FUT_MAX_RETRIES', 3),
  futPriceToleranceBps: numberEnv('FUT_PRICE_TOLERANCE_BPS', 500),
  futLowBalanceMinor: numberEnv('FUT_LOW_BALANCE_MINOR', 100000),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
  telegramEnabled: process.env.TELEGRAM_ENABLED === 'true',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
  s3Region: process.env.S3_REGION ?? 'auto',
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  s3SignedUrlTtlSeconds: numberEnv('S3_SIGNED_URL_TTL_SECONDS', 300),
  malwareScannerUrl: process.env.MALWARE_SCANNER_URL ?? '',
  malwareScanRequired: process.env.MALWARE_SCAN_REQUIRED === 'true',
  malwareScannerTimeoutMs: numberEnv('MALWARE_SCANNER_TIMEOUT_MS', 5000),
  healthcheckToken: process.env.HEALTHCHECK_TOKEN ?? ''
};

export function requireConfig(name: keyof typeof env): string {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing required configuration: ${name}`);
  return value;
}

export function assertProductionConfig(): void {
  if (!production) return;
  for (const key of ['databaseUrl', 'sessionCookieSecret', 'credentialKeys'] as const) requireConfig(key);
  if (env.sessionCookieSecret.length < 32) throw new Error('SESSION_COOKIE_SECRET must be at least 32 characters');
}

export function parseCredentialKeys(): Map<string, Buffer> {
  const raw = env.credentialKeys || process.env.CREDENTIAL_ENCRYPTION_KEY || '';
  if (!raw) return new Map();
  let parsed: Record<string, string>;
  try {
    parsed = raw.trim().startsWith('{') ? JSON.parse(raw) as Record<string, string> : { [env.credentialActiveKeyVersion]: raw };
  } catch {
    throw new Error('CREDENTIAL_ENCRYPTION_KEYS must be valid JSON or a base64 key');
  }
  const keys = new Map<string, Buffer>();
  for (const [version, encoded] of Object.entries(parsed)) {
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) throw new Error(`Credential key ${version} must decode to 32 bytes`);
    keys.set(version, key);
  }
  return keys;
}
