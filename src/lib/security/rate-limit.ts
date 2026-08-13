import { createHash } from 'node:crypto';
import { db } from '@/lib/db';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function checkRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }
  if (bucket.count >= limit) return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
}

export async function checkSharedRateLimit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1) throw new Error('Invalid rate-limit configuration');
  const keyHash = createHash('sha256').update(key).digest('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowMs);
  const rows = await db.$queryRaw<Array<{ count: number; expiresAt: Date }>>`
    INSERT INTO "RateLimitBucket" ("keyHash", "count", "expiresAt", "updatedAt")
    VALUES (${keyHash}, 1, ${expiresAt}, ${now})
    ON CONFLICT ("keyHash") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "expiresAt" = CASE WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN ${expiresAt} ELSE "RateLimitBucket"."expiresAt" END,
      "updatedAt" = ${now}
    RETURNING "count", "expiresAt"
  `;
  const bucket = rows[0];
  return { allowed: bucket.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((bucket.expiresAt.getTime() - now.getTime()) / 1000)) };
}

export async function deleteExpiredRateLimitBuckets(): Promise<number> {
  const result = await db.rateLimitBucket.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return result.count;
}
