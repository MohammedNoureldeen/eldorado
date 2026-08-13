import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { assert } from '@/lib/errors';
import { AuthUser, assertRole } from '@/lib/auth/rbac';

const allowedKeys = new Set(['futApprovalLimitMinor', 'futPriceToleranceBps', 'futLowBalanceMinor', 'workerQuoteVisibility', 'credentialRetentionDays', 'telegramQuietHours', 'lateStartMinutes', 'disconnectAlertMinutes']);
type Actor = Pick<AuthUser, 'id' | 'organizationId' | 'role'>;

export async function getSetting<T>(organizationId: string, key: string, fallback: T): Promise<T> {
  const setting = await db.setting.findUnique({ where: { organizationId_key: { organizationId, key } } });
  return (setting?.valueJson as T | undefined) ?? fallback;
}

export async function updateSettings(actor: Actor, input: Record<string, unknown>): Promise<void> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  for (const key of Object.keys(input)) assert(allowedKeys.has(key), 400, `Unsupported setting: ${key}`);
  if ('futApprovalLimitMinor' in input) assert(Number.isSafeInteger(input.futApprovalLimitMinor) && Number(input.futApprovalLimitMinor) >= 0, 400, 'FUT approval limit must be non-negative integer cents');
  if ('futPriceToleranceBps' in input) assert(Number.isInteger(input.futPriceToleranceBps) && Number(input.futPriceToleranceBps) >= 0 && Number(input.futPriceToleranceBps) <= 10_000, 400, 'FUT price tolerance must be 0-100 percent');
  if ('futLowBalanceMinor' in input) assert(Number.isSafeInteger(input.futLowBalanceMinor) && Number(input.futLowBalanceMinor) >= 0, 400, 'FUT low-balance threshold must be non-negative integer cents');
  if ('workerQuoteVisibility' in input) assert(typeof input.workerQuoteVisibility === 'boolean', 400, 'Worker quote visibility must be true or false');
  if ('credentialRetentionDays' in input) assert(input.credentialRetentionDays === 7, 400, 'Credential retention is fixed at seven days for this MVP');
  for (const key of ['lateStartMinutes', 'disconnectAlertMinutes']) if (key in input) assert(Number.isInteger(input[key]) && Number(input[key]) >= 0, 400, `${key} must be a non-negative integer`);
  await db.$transaction(Object.entries(input).map(([key, value]) => db.setting.upsert({ where: { organizationId_key: { organizationId: actor.organizationId, key } }, create: { organizationId: actor.organizationId, key, valueJson: value as object, updatedById: actor.id }, update: { valueJson: value as object, updatedById: actor.id } })));
  await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action: 'SETTINGS_UPDATED', entityType: 'SETTING', result: 'SUCCESS', metadataJson: { keys: Object.keys(input) } } });
}

export async function listSettings(actor: Actor): Promise<Record<string, unknown>> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const rows = await db.setting.findMany({ where: { organizationId: actor.organizationId, key: { in: [...allowedKeys] } } });
  return Object.fromEntries(rows.map((row) => [row.key, row.valueJson]));
}
