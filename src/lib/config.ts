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
  futApiUser: process.env.FUT_API_USER ?? '',
  futApiKeyMd5: process.env.FUT_API_KEY_MD5 ?? '',
  futOwnedCostPer100kMinor: numberEnv('FUT_OWNED_COST_PER_100K_MINOR', 0),
  futTimeoutMs: numberEnv('FUT_TIMEOUT_MS', 8000),
  futMaxRetries: numberEnv('FUT_MAX_RETRIES', 3),
  futPriceToleranceBps: numberEnv('FUT_PRICE_TOLERANCE_BPS', 500),
  futLowBalanceMinor: numberEnv('FUT_LOW_BALANCE_MINOR', 100000),
  futProviderMode: process.env.FUT_PROVIDER_MODE ?? (production ? 'http' : 'fake'),
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
  proofStorageMode: process.env.PROOF_STORAGE_MODE ?? (production ? 's3' : 'memory'),
  healthcheckToken: process.env.HEALTHCHECK_TOKEN ?? '',
  backgroundJobLeaseMs: numberEnv('BACKGROUND_JOB_LEASE_MS', 10 * 60_000),
  notificationLeaseMs: numberEnv('NOTIFICATION_LEASE_MS', 2 * 60_000)
};

export function requireConfig(name: keyof typeof env): string {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing required configuration: ${name}`);
  return value;
}

export function assertProductionConfig(): void {
  if (!production) return;
  validateProductionConfig(env);
}

type ProductionConfig = Pick<typeof env, 'databaseUrl' | 'sessionCookieSecret' | 'credentialKeys' | 'credentialActiveKeyVersion' | 'healthcheckToken' | 'futProviderMode' | 'futApiUser' | 'futApiKeyMd5' | 'proofStorageMode' | 's3Endpoint' | 's3Bucket' | 's3AccessKeyId' | 's3SecretAccessKey'>;

export function validateProductionConfig(config: ProductionConfig): void {
  if (!config.databaseUrl) throw new Error('Missing required configuration: databaseUrl');
  if (!config.sessionCookieSecret) throw new Error('Missing required configuration: sessionCookieSecret');
  if (!config.credentialKeys) throw new Error('Missing required configuration: credentialKeys');
  if (!config.healthcheckToken) throw new Error('Missing required configuration: healthcheckToken');
  if (config.sessionCookieSecret.length < 32) throw new Error('SESSION_COOKIE_SECRET must be at least 32 characters');
  if (config.healthcheckToken.length < 32) throw new Error('HEALTHCHECK_TOKEN must be at least 32 characters');
  const keys = parseCredentialKeyInput(config.credentialKeys, config.credentialActiveKeyVersion);
  if (!keys.has(config.credentialActiveKeyVersion)) throw new Error('CREDENTIAL_ACTIVE_KEY_VERSION must identify a configured key');
  if (config.futProviderMode !== 'http') throw new Error('FUT_PROVIDER_MODE must be http in production');
  if (!config.futApiUser) throw new Error('Missing required configuration: futApiUser');
  if (!/^[a-f0-9]{32}$/i.test(config.futApiKeyMd5)) throw new Error('FUT_API_KEY_MD5 must be a 32-character MD5 hash');
  if (config.proofStorageMode !== 's3') throw new Error('PROOF_STORAGE_MODE must be s3 in production');
  if (![config.s3Endpoint, config.s3Bucket, config.s3AccessKeyId, config.s3SecretAccessKey].every(Boolean)) throw new Error('S3 proof storage configuration is required in production');
}

function parseCredentialKeyInput(raw: string, activeVersion: string): Map<string, Buffer> {
  if (!raw) return new Map();
  let parsed: Record<string, string>;
  try {
    parsed = raw.trim().startsWith('{') ? JSON.parse(raw) as Record<string, string> : { [activeVersion]: raw };
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

export function parseCredentialKeys(): Map<string, Buffer> {
  return parseCredentialKeyInput(env.credentialKeys || process.env.CREDENTIAL_ENCRYPTION_KEY || '', env.credentialActiveKeyVersion);
}
