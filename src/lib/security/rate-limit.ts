type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// ponytail: process-local limiter; use a shared store before running multiple instances.
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
