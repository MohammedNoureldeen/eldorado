import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { UserRole, UserStatus } from '@prisma/client';
import { db } from '../src/lib/db';
import { listOrders } from '../src/lib/orders/service';
import { checkSharedRateLimit } from '../src/lib/security/rate-limit';

async function main() {
  const worker = await db.user.findFirstOrThrow({ where: { role: UserRole.WORKER, status: UserStatus.ACTIVE } });
  const actor = { id: worker.id, organizationId: worker.organizationId, role: UserRole.WORKER, status: UserStatus.ACTIVE, name: worker.name, email: worker.email } as const;
  const durations: number[] = [];
  await Promise.all(Array.from({ length: 100 }, async () => {
    const started = performance.now();
    const orders = await listOrders(actor);
    assert(Array.isArray(orders));
    durations.push(performance.now() - started);
  }));
  const limiterKey = `load:${randomUUID()}`;
  const limiter = await Promise.all(Array.from({ length: 200 }, () => checkSharedRateLimit(limiterKey, 125, 60_000)));
  assert.equal(limiter.filter((result) => result.allowed).length, 125);
  durations.sort((a, b) => a - b);
  const p95 = durations[Math.floor(durations.length * 0.95) - 1];
  console.log(JSON.stringify({ concurrentOrderReads: 100, sharedLimiterWrites: 200, sharedLimiterAllowed: 125, orderReadP95Ms: Math.round(p95), orderReadMaxMs: Math.round(durations.at(-1) ?? 0) }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
