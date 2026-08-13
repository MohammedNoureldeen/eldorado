import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { AuthUser, assertRole } from '@/lib/auth/rbac';
import { assert } from '@/lib/errors';
import { redactSensitive } from '@/lib/domain';

type Actor = Pick<AuthUser, 'id' | 'organizationId' | 'role'>;

export async function economyConfiguration(actor: Actor): Promise<{ feeBps: number; effectiveFrom: string; publicOrders: number; ownedOrders: number }> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const now = new Date();
  const [policy, bySource] = await Promise.all([
    db.marketplaceFeePolicy.findFirst({ where: { organizationId: actor.organizationId, active: true, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: { effectiveFrom: 'desc' } }),
    db.order.groupBy({ by: ['fulfillmentSource'], where: { organizationId: actor.organizationId }, _count: { _all: true } })
  ]);
  const counts = Object.fromEntries(bySource.map((row) => [row.fulfillmentSource, row._count._all]));
  return { feeBps: policy?.feeBps ?? 500, effectiveFrom: (policy?.effectiveFrom ?? now).toISOString(), publicOrders: counts.PUBLIC_SUPPLIER ?? 0, ownedOrders: counts.OWNED_SENDERS ?? 0 };
}

export async function updateMarketplaceFee(actor: Actor, feeBps: number): Promise<void> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  assert(Number.isInteger(feeBps) && feeBps >= 0 && feeBps <= 10_000, 400, 'Marketplace fee must be between 0 and 100 percent');
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.marketplaceFeePolicy.updateMany({ where: { organizationId: actor.organizationId, active: true, effectiveTo: null }, data: { active: false, effectiveTo: now } });
    const policy = await tx.marketplaceFeePolicy.create({ data: { organizationId: actor.organizationId, feeBps, effectiveFrom: now, active: true } });
    await tx.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action: 'MARKETPLACE_FEE_POLICY_UPDATED', entityType: 'MARKETPLACE_FEE_POLICY', entityId: policy.id, result: 'SUCCESS', metadataJson: { feeBps, effectiveFrom: now.toISOString() } } });
  });
}

export async function recentAuditEvents(actor: Actor, limit = 50): Promise<unknown[]> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const events = await db.auditEvent.findMany({ where: { organizationId: actor.organizationId }, include: { actor: { select: { name: true, email: true } }, order: { select: { orderReference: true } } }, orderBy: { createdAt: 'desc' }, take: safeLimit });
  return events.map((event) => ({ id: event.id, action: event.action, entityType: event.entityType, entityId: event.entityId, result: event.result, actor: event.actor ? { name: event.actor.name, email: event.actor.email } : null, orderReference: event.order?.orderReference ?? null, metadata: redactSensitive(event.metadataJson), createdAt: event.createdAt }));
}
