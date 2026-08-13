import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { env } from '@/lib/config';
import { decryptCredentialSet, encryptCredentialSet } from '@/lib/crypto/secrets';
import { AuthUser, assertRole } from '@/lib/auth/rbac';

type Actor = Pick<AuthUser, 'id' | 'organizationId' | 'role'>;

export async function rotateCredentialEncryption(actor: Actor, batchSize = 100): Promise<{ rotated: number; failed: number; remaining: number }> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const take = Math.min(Math.max(Math.trunc(batchSize), 1), 500);
  const rows = await db.customerCredential.findMany({ where: { order: { organizationId: actor.organizationId }, deletedAt: null, keyVersion: { not: env.credentialActiveKeyVersion }, emailCiphertext: { not: null }, passwordCiphertext: { not: null } }, take, orderBy: { updatedAt: 'asc' }, include: { order: { select: { id: true } } } });
  let rotated = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const encrypted = encryptCredentialSet(decryptCredentialSet(row));
      const updated = await db.customerCredential.updateMany({ where: { id: row.id, keyVersion: row.keyVersion, deletedAt: null }, data: encrypted });
      if (!updated.count) continue;
      rotated += 1;
      await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId: row.order.id, action: 'CREDENTIAL_KEY_ROTATED', entityType: 'CUSTOMER_CREDENTIAL', entityId: row.id, result: 'SUCCESS', metadataJson: { previousVersion: row.keyVersion, activeVersion: env.credentialActiveKeyVersion } } });
    } catch (error) {
      failed += 1;
      await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId: row.order.id, action: 'CREDENTIAL_KEY_ROTATION_FAILED', entityType: 'CUSTOMER_CREDENTIAL', entityId: row.id, result: 'FAILURE', metadataJson: { previousVersion: row.keyVersion, activeVersion: env.credentialActiveKeyVersion, errorType: error instanceof Error ? error.name : 'UnknownError' } } });
    }
  }
  const remaining = await db.customerCredential.count({ where: { order: { organizationId: actor.organizationId }, deletedAt: null, keyVersion: { not: env.credentialActiveKeyVersion }, emailCiphertext: { not: null }, passwordCiphertext: { not: null } } });
  return { rotated, failed, remaining };
}

export async function credentialRetentionReport(actor: Actor): Promise<{ active: number; dueWithinSevenDays: number; overdue: number; deleted: number; deletionFailures: number; legacyKeyVersions: number }> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const now = new Date();
  const sevenDays = new Date(now.getTime() + 7 * 86_400_000);
  const scope = { order: { organizationId: actor.organizationId } } as const;
  const [active, dueWithinSevenDays, overdue, deleted, deletionFailures, legacyKeyVersions] = await Promise.all([
    db.customerCredential.count({ where: { ...scope, deletedAt: null } }),
    db.customerCredential.count({ where: { ...scope, deletedAt: null, deletionDueAt: { gt: now, lte: sevenDays } } }),
    db.customerCredential.count({ where: { ...scope, deletedAt: null, deletionDueAt: { lte: now } } }),
    db.customerCredential.count({ where: { ...scope, deletedAt: { not: null } } }),
    db.customerCredential.count({ where: { ...scope, deletionFailure: { not: null } } }),
    db.customerCredential.count({ where: { ...scope, deletedAt: null, keyVersion: { not: env.credentialActiveKeyVersion } } })
  ]);
  return { active, dueWithinSevenDays, overdue, deleted, deletionFailures, legacyKeyVersions };
}
