import { FulfillmentSource, OrderStatus, Platform, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { AuthUser, assertRole } from '@/lib/auth/rbac';
import { assert } from '@/lib/errors';
import { FutProvider } from '@/lib/integrations/fut';
import { confirmFutOrder } from '@/lib/orders/service';

export type AutomationMode = 'MANUAL' | 'LIMIT_BASED' | 'AUTOMATIC';
export type AutomationPolicy = {
  mode: AutomationMode;
  killSwitch: boolean;
  maxGrossSaleMinor: number;
  maxCoinQuantity: number;
  maxQuoteAgeSeconds: number;
  minMarginBps: number;
  minBalanceAfterMinor: number;
  maxConsecutiveFailures: number;
  maxRiskLevel: number;
  allowedPlatforms: Platform[];
  allowedSources: FulfillmentSource[];
};

export const defaultAutomationPolicy: AutomationPolicy = {
  mode: 'MANUAL',
  killSwitch: true,
  maxGrossSaleMinor: 0,
  maxCoinQuantity: 200_000,
  maxQuoteAgeSeconds: 60,
  minMarginBps: 0,
  minBalanceAfterMinor: 0,
  maxConsecutiveFailures: 1,
  maxRiskLevel: 1,
  allowedPlatforms: [],
  allowedSources: []
};

type Actor = Pick<AuthUser, 'id' | 'organizationId' | 'role'>;
export type AutomationCandidate = { status: string; grossSaleMinor: number; marketplaceFeeMinor: number; coinQuantity: number; platform: Platform; fulfillmentSource: FulfillmentSource; hasCredentials: boolean; submissionState?: string; estimatedCostMinor?: number | null; quoteFetchedAt?: Date | null; quoteExpiresAt?: Date | null; riskLevel?: string | null; consecutiveFailures: number; cooldownActive?: boolean; balanceMinor?: number };

export function evaluateAutomation(policy: AutomationPolicy, candidate: AutomationCandidate, now = new Date()): { eligible: boolean; reasons: string[]; marginBps?: number } {
  const reasons: string[] = [];
  if (policy.killSwitch) reasons.push('KILL_SWITCH_ACTIVE');
  if (policy.mode === 'MANUAL') reasons.push('MANUAL_MODE');
  if (candidate.status !== OrderStatus.APPROVED) reasons.push('ORDER_NOT_APPROVED');
  if (!candidate.hasCredentials) reasons.push('MISSING_CREDENTIALS');
  if (candidate.submissionState !== 'PREPARED') reasons.push(candidate.submissionState === 'UNKNOWN' ? 'UNKNOWN_SUBMISSION' : 'NOT_PREPARED');
  if (candidate.estimatedCostMinor == null) reasons.push('MISSING_QUOTE');
  if (!candidate.quoteFetchedAt || now.getTime() - candidate.quoteFetchedAt.getTime() > policy.maxQuoteAgeSeconds * 1000 || (candidate.quoteExpiresAt && candidate.quoteExpiresAt <= now)) reasons.push('STALE_QUOTE');
  if (policy.maxGrossSaleMinor <= 0 || candidate.grossSaleMinor > policy.maxGrossSaleMinor) reasons.push('ORDER_LIMIT_EXCEEDED');
  if (candidate.coinQuantity > policy.maxCoinQuantity) reasons.push('COIN_LIMIT_EXCEEDED');
  if (!policy.allowedPlatforms.includes(candidate.platform)) reasons.push('PLATFORM_NOT_ALLOWED');
  if (!policy.allowedSources.includes(candidate.fulfillmentSource)) reasons.push('SOURCE_NOT_ALLOWED');
  if (candidate.riskLevel && (!/^[1-6]$/.test(candidate.riskLevel) || Number(candidate.riskLevel) > policy.maxRiskLevel)) reasons.push('RISK_POLICY_VIOLATION');
  if (candidate.cooldownActive) reasons.push('COOLDOWN_ACTIVE');
  if (candidate.consecutiveFailures >= policy.maxConsecutiveFailures) reasons.push('REPEATED_FAILURES');
  if (candidate.balanceMinor != null && candidate.estimatedCostMinor != null && candidate.balanceMinor - candidate.estimatedCostMinor < policy.minBalanceAfterMinor) reasons.push('LOW_BALANCE');
  let marginBps: number | undefined;
  if (candidate.estimatedCostMinor != null && candidate.grossSaleMinor > 0) {
    marginBps = Math.trunc((candidate.grossSaleMinor - candidate.marketplaceFeeMinor - candidate.estimatedCostMinor) * 10_000 / candidate.grossSaleMinor);
    if (marginBps < policy.minMarginBps) reasons.push('MARGIN_BELOW_LIMIT');
  }
  return { eligible: reasons.length === 0, reasons, marginBps };
}

function policyFromSettings(settings: Record<string, unknown>): AutomationPolicy {
  const mode = settings.automationMode;
  return {
    mode: mode === 'LIMIT_BASED' || mode === 'AUTOMATIC' ? mode : 'MANUAL',
    killSwitch: settings.automationKillSwitch !== false,
    maxGrossSaleMinor: Number(settings.automationMaxGrossSaleMinor ?? 0),
    maxCoinQuantity: Number(settings.automationMaxCoinQuantity ?? 200_000),
    maxQuoteAgeSeconds: Number(settings.automationMaxQuoteAgeSeconds ?? 60),
    minMarginBps: Number(settings.automationMinMarginBps ?? 0),
    minBalanceAfterMinor: Number(settings.automationMinBalanceAfterMinor ?? 0),
    maxConsecutiveFailures: Number(settings.automationMaxConsecutiveFailures ?? 1),
    maxRiskLevel: Number(settings.automationMaxRiskLevel ?? 1),
    allowedPlatforms: Array.isArray(settings.automationAllowedPlatforms) ? settings.automationAllowedPlatforms.filter((value): value is Platform => Object.values(Platform).includes(value as Platform)) : [],
    allowedSources: Array.isArray(settings.automationAllowedSources) ? settings.automationAllowedSources.filter((value): value is FulfillmentSource => Object.values(FulfillmentSource).includes(value as FulfillmentSource)) : []
  };
}

export async function getAutomationPolicy(actor: Actor): Promise<AutomationPolicy> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const rows = await db.setting.findMany({ where: { organizationId: actor.organizationId, key: { startsWith: 'automation' } } });
  return policyFromSettings(Object.fromEntries(rows.map((row) => [row.key, row.valueJson])));
}

export async function updateAutomationPolicy(actor: Actor, policy: AutomationPolicy, acknowledgement?: string): Promise<void> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  assert(['MANUAL', 'LIMIT_BASED', 'AUTOMATIC'].includes(policy.mode), 400, 'Invalid automation mode');
  for (const [name, value] of Object.entries({ maxGrossSaleMinor: policy.maxGrossSaleMinor, maxCoinQuantity: policy.maxCoinQuantity, maxQuoteAgeSeconds: policy.maxQuoteAgeSeconds, minMarginBps: policy.minMarginBps, minBalanceAfterMinor: policy.minBalanceAfterMinor, maxConsecutiveFailures: policy.maxConsecutiveFailures, maxRiskLevel: policy.maxRiskLevel })) assert(Number.isSafeInteger(value) && value >= 0, 400, `${name} must be a non-negative integer`);
  assert(policy.maxQuoteAgeSeconds >= 15 && policy.maxQuoteAgeSeconds <= 300, 400, 'Quote age must be 15-300 seconds');
  assert(policy.minMarginBps <= 10_000, 400, 'Minimum margin must be 0-100 percent');
  assert(policy.maxConsecutiveFailures >= 1 && policy.maxConsecutiveFailures <= 10, 400, 'Failure limit must be 1-10');
  assert(policy.maxRiskLevel >= 1 && policy.maxRiskLevel <= 6, 400, 'Maximum risk level must be 1-6');
  assert(policy.allowedPlatforms.every((value) => Object.values(Platform).includes(value)), 400, 'Invalid allowed platform');
  assert(policy.allowedSources.every((value) => Object.values(FulfillmentSource).includes(value)), 400, 'Invalid allowed fulfillment source');
  if (policy.mode !== 'MANUAL' || !policy.killSwitch) assert(acknowledgement === 'ENABLE CONTROLLED AUTOMATION', 400, 'Exact automation acknowledgement is required');
  if (policy.mode === 'AUTOMATIC' && !policy.killSwitch) {
    assert(policy.maxGrossSaleMinor > 0 && policy.allowedPlatforms.length > 0 && policy.allowedSources.length > 0, 400, 'Automatic mode requires explicit limits, platforms, and sources');
  }
  const values: Record<string, unknown> = { automationMode: policy.mode, automationKillSwitch: policy.killSwitch, automationMaxGrossSaleMinor: policy.maxGrossSaleMinor, automationMaxCoinQuantity: policy.maxCoinQuantity, automationMaxQuoteAgeSeconds: policy.maxQuoteAgeSeconds, automationMinMarginBps: policy.minMarginBps, automationMinBalanceAfterMinor: policy.minBalanceAfterMinor, automationMaxConsecutiveFailures: policy.maxConsecutiveFailures, automationMaxRiskLevel: policy.maxRiskLevel, automationAllowedPlatforms: policy.allowedPlatforms, automationAllowedSources: policy.allowedSources };
  await db.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(values)) await tx.setting.upsert({ where: { organizationId_key: { organizationId: actor.organizationId, key } }, create: { organizationId: actor.organizationId, key, valueJson: value as object, updatedById: actor.id }, update: { valueJson: value as object, updatedById: actor.id } });
    await tx.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action: 'AUTOMATION_POLICY_UPDATED', entityType: 'SETTING', result: 'SUCCESS', metadataJson: { mode: policy.mode, killSwitch: policy.killSwitch, limitsConfigured: policy.maxGrossSaleMinor > 0, allowedPlatforms: policy.allowedPlatforms, allowedSources: policy.allowedSources } } });
  });
}

export async function emergencyStopAutomation(actor: Actor): Promise<void> {
  const current = await getAutomationPolicy(actor);
  await updateAutomationPolicy(actor, { ...current, mode: 'MANUAL', killSwitch: true });
  await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action: 'AUTOMATION_EMERGENCY_STOP', entityType: 'SETTING', result: 'SUCCESS' } });
}

export async function attemptAutomatedFutOrder(actor: Actor, orderId: string, provider: FutProvider): Promise<{ submitted: boolean; reasons: string[] }> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const policy = await getAutomationPolicy(actor);
  if (policy.mode === 'MANUAL') return { submitted: false, reasons: ['CONTROLLED_SUBMISSION_DISABLED'] };
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId }, include: { credentials: true, futOrder: true, futApiEvents: { orderBy: { createdAt: 'desc' }, take: 20 } } });
  assert(order, 404, 'Order not found');
  const consecutiveFailures = order.futApiEvents.findIndex((event) => !(event.responseMetadataJson as Record<string, unknown> | null)?.errorCode);
  const latestErrorCode = (order.futApiEvents[0]?.responseMetadataJson as Record<string, unknown> | null)?.errorCode;
  let balanceMinor: number | undefined;
  if (order.fulfillmentSource === FulfillmentSource.PUBLIC_SUPPLIER) balanceMinor = (await provider.getBalance()).balanceMinor;
  const decision = evaluateAutomation(policy, { status: order.status, grossSaleMinor: order.grossSaleMinor, marketplaceFeeMinor: order.marketplaceFeeMinor, coinQuantity: order.coinQuantity, platform: order.platform, fulfillmentSource: order.fulfillmentSource, hasCredentials: Boolean(order.credentials?.emailCiphertext && order.credentials.passwordCiphertext && !order.credentials.deletedAt), submissionState: order.futOrder?.submissionState, estimatedCostMinor: order.futOrder?.estimatedCostMinor, quoteFetchedAt: order.futOrder?.quoteFetchedAt, quoteExpiresAt: order.futOrder?.quoteExpiresAt, riskLevel: order.futOrder?.riskLevel, consecutiveFailures: consecutiveFailures === -1 ? order.futApiEvents.length : consecutiveFailures, cooldownActive: latestErrorCode === 'RATE_LIMIT' || latestErrorCode === 'FUT_RATE_LIMITED', balanceMinor });
  await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId, action: 'AUTOMATION_EVALUATED', entityType: 'FUT_ORDER', entityId: order.futOrder?.id, result: decision.eligible ? 'SUCCESS' : 'BLOCKED', metadataJson: { reasons: decision.reasons, marginBps: decision.marginBps } } });
  if (!decision.eligible) return { submitted: false, reasons: decision.reasons };
  await confirmFutOrder(actor, orderId, order.version, provider, { source: 'automation' });
  return { submitted: true, reasons: [] };
}
