import { randomUUID } from 'node:crypto';
import { JobStatus, OrderStatus, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { deleteExpiredCredentials, syncFutOrder } from '@/lib/orders/service';
import { deliverPendingTelegram, enqueueTelegram } from '@/lib/notifications/telegram';
import { defaultFutProvider } from '@/lib/integrations/fut';
import { env } from '@/lib/config';
import { deleteExpiredRateLimitBuckets } from '@/lib/security/rate-limit';

export async function enqueueJob(type: string, payload: unknown, organizationId?: string, runAt = new Date()): Promise<string> {
  const job = await db.backgroundJob.create({ data: { type, payloadJson: payload as object, organizationId, runAt } });
  return job.id;
}

export async function runBackgroundJobs(limit = 20): Promise<{ processed: number; succeeded: number; failed: number }> {
  const workerId = randomUUID();
  await db.backgroundJob.updateMany({ where: { status: JobStatus.RUNNING, lockedAt: { lt: new Date(Date.now() - env.backgroundJobLeaseMs) } }, data: { status: JobStatus.PENDING, lockedAt: null, lockedBy: null, lastError: 'Recovered after worker lease expired' } });
  const candidates = await db.backgroundJob.findMany({ where: { status: JobStatus.PENDING, runAt: { lte: new Date() } }, take: limit, orderBy: { runAt: 'asc' } });
  let succeeded = 0, failed = 0;
  await deleteExpiredCredentials().catch(() => undefined);
  await deliverPendingTelegram().catch(() => undefined);
  await deleteExpiredRateLimitBuckets().catch(() => undefined);
  const overdue = await db.order.findMany({ where: { deadline: { lte: new Date() }, status: { notIn: [OrderStatus.COMPLETED, OrderStatus.FAILED, OrderStatus.CANCELLED, OrderStatus.REFUNDED] } }, take: 50, select: { id: true, organizationId: true, orderReference: true } });
  for (const order of overdue) await enqueueTelegram({ organizationId: order.organizationId, orderId: order.id, type: 'ORDER_OVERDUE', message: `Order ${order.orderReference} is overdue.`, dedupeKey: `order-overdue:${order.id}:${new Date().toISOString().slice(0, 10)}`, critical: true }).catch(() => undefined);
  for (const candidate of candidates) {
    const claimed = await db.backgroundJob.updateMany({ where: { id: candidate.id, status: JobStatus.PENDING }, data: { status: JobStatus.RUNNING, lockedAt: new Date(), lockedBy: workerId, attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    try {
      let result: unknown = null;
      const payload = candidate.payloadJson as { orderId?: string };
      if (candidate.type === 'DELETE_EXPIRED_CREDENTIALS') result = { deleted: await deleteExpiredCredentials() };
      else if (candidate.type === 'DELIVER_TELEGRAM') result = { sent: await deliverPendingTelegram() };
      else if (candidate.type === 'SYNC_FUT_ORDER' && candidate.organizationId && payload.orderId) {
        const admin = await db.user.findFirst({ where: { organizationId: candidate.organizationId, role: UserRole.OWNER_ADMIN, status: 'ACTIVE' } });
        if (!admin) throw new Error('No active administrator available for FUT synchronization');
        await syncFutOrder(admin, payload.orderId, defaultFutProvider());
        result = { synced: payload.orderId };
      } else throw new Error(`Unsupported background job type: ${candidate.type}`);
      await db.backgroundJob.update({ where: { id: candidate.id }, data: { status: JobStatus.SUCCEEDED, resultJson: result as object, lockedAt: null, lockedBy: null } });
      succeeded += 1;
    } catch (error) {
      const retry = candidate.attempts + 1 < candidate.maxAttempts;
      await db.backgroundJob.update({ where: { id: candidate.id }, data: { status: retry ? JobStatus.PENDING : JobStatus.FAILED, runAt: retry ? new Date(Date.now() + Math.min(60_000 * 2 ** candidate.attempts, 3_600_000)) : undefined, lastError: error instanceof Error ? error.message : 'Job failed', lockedAt: null, lockedBy: null } });
      failed += 1;
    }
  }
  return { processed: succeeded + failed, succeeded, failed };
}
