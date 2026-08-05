import { UserRole, UserStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { assert } from '@/lib/errors';
import { AuthUser, assertRole } from '@/lib/auth/rbac';
import { hashPassword } from '@/lib/auth/password';

type Actor = Pick<AuthUser, 'id' | 'organizationId' | 'role'>;

export async function listWorkers(actor: Actor): Promise<unknown> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  return db.user.findMany({ where: { organizationId: actor.organizationId, role: UserRole.WORKER }, select: { id: true, name: true, email: true, status: true, createdAt: true, lastLoginAt: true, workerProfile: { select: { employmentStart: true, employmentEnd: true, telegramChatId: true, scheduleJson: true, salaryPolicyId: true } }, _count: { select: { assignedOrders: true, shifts: true } } }, orderBy: { name: 'asc' } });
}

export async function createWorker(actor: Actor, input: { name: string; email: string; password: string; telegramChatId?: string }): Promise<{ id: string }> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  assert(input.name.trim().length >= 2 && input.name.length <= 120, 400, 'Worker name is required');
  const email = input.email.trim().toLowerCase();
  assert(email.includes('@') && email.length <= 320, 400, 'Worker email is invalid');
  assert(input.password.length >= 12, 400, 'Worker password must be at least 12 characters');
  const user = await db.user.create({ data: { organizationId: actor.organizationId, name: input.name.trim(), email, role: UserRole.WORKER, status: UserStatus.ACTIVE, passwordHash: await hashPassword(input.password), passwordChangedAt: new Date(), workerProfile: { create: { organizationId: actor.organizationId, employmentStart: new Date(), telegramChatId: input.telegramChatId?.trim() } } } });
  await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action: 'WORKER_CREATED', entityType: 'USER', entityId: user.id, result: 'SUCCESS', metadataJson: { email, name: input.name.trim() } } });
  return { id: user.id };
}

export async function updateWorker(actor: Actor, workerId: string, input: { status?: UserStatus; name?: string; telegramChatId?: string | null; scheduleJson?: unknown; salaryPolicyId?: string | null }): Promise<void> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const worker = await db.user.findFirst({ where: { id: workerId, organizationId: actor.organizationId, role: UserRole.WORKER } });
  assert(worker, 404, 'Worker not found');
  await db.user.update({ where: { id: workerId }, data: { status: input.status, name: input.name?.trim(), workerProfile: { upsert: { create: { organizationId: actor.organizationId, telegramChatId: input.telegramChatId ?? undefined, scheduleJson: input.scheduleJson as object | undefined, salaryPolicyId: input.salaryPolicyId }, update: { telegramChatId: input.telegramChatId, scheduleJson: input.scheduleJson as object | undefined, salaryPolicyId: input.salaryPolicyId } } } } });
  await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action: 'WORKER_UPDATED', entityType: 'USER', entityId: workerId, result: 'SUCCESS', metadataJson: { keys: Object.keys(input) } } });
}

export async function revokeWorkerSessions(actor: Actor, workerId: string): Promise<number> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const worker = await db.user.findFirst({ where: { id: workerId, organizationId: actor.organizationId, role: UserRole.WORKER } });
  assert(worker, 404, 'Worker not found');
  const result = await db.session.updateMany({ where: { userId: workerId, organizationId: actor.organizationId, revokedAt: null }, data: { revokedAt: new Date() } });
  await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action: 'WORKER_SESSIONS_REVOKED', entityType: 'USER', entityId: workerId, result: 'SUCCESS', metadataJson: { count: result.count } } });
  return result.count;
}
