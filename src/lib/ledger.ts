import { FinancialEntryType, OrderStatus, PayrollStatus, Prisma, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { AppError, assert } from '@/lib/errors';
import { assertTransition, calculateProfit, closureDeletionDate } from '@/lib/domain';
import { AuthUser, assertRole } from '@/lib/auth/rbac';

const RATE_SCALE = 100_000_000n;

export function parseFixedRate(value: string | number): bigint {
  const text = String(value);
  if (!/^\d+(\.\d{1,8})?$/.test(text)) throw new Error('Exchange rate must be a positive decimal with up to 8 places');
  const [whole, decimal = ''] = text.split('.');
  return BigInt(whole) * RATE_SCALE + BigInt(decimal.padEnd(8, '0'));
}

export function convertMinorToEgp(amountMinor: number, rate: string | number): number {
  const result = (BigInt(amountMinor) * parseFixedRate(rate) + RATE_SCALE / 2n) / RATE_SCALE;
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('Converted amount exceeds safe integer range');
  return Number(result);
}

type Actor = Pick<AuthUser, 'id' | 'organizationId' | 'role'>;

export async function addFinancialEntry(actor: Actor, orderId: string, input: { type: FinancialEntryType; amountMinor: number; currency: string; egpAmountMinor?: number; exchangeRate?: string; reason?: string; reversalOfId?: string }): Promise<string> {
  assert(Number.isSafeInteger(input.amountMinor) && input.amountMinor >= 0, 400, 'Financial amount must be a non-negative integer minor unit');
  assert(/^[A-Z]{3}$/.test(input.currency), 400, 'Currency must be a three-letter ISO code');
  if (input.type === FinancialEntryType.ADJUSTMENT || input.type === FinancialEntryType.REFUND) assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId } });
  assert(order, 404, 'Order not found', 'ORDER_NOT_FOUND');
  let egpAmountMinor = input.egpAmountMinor;
  let exchangeRate: Prisma.Decimal | undefined;
  if (input.exchangeRate !== undefined) {
    egpAmountMinor = convertMinorToEgp(input.amountMinor, input.exchangeRate);
    exchangeRate = new Prisma.Decimal(input.exchangeRate);
  }
  assert(egpAmountMinor === undefined || Number.isSafeInteger(egpAmountMinor), 400, 'EGP amount must be an integer minor unit');
  const entry = await db.financialEntry.create({ data: { organizationId: actor.organizationId, orderId, type: input.type, amountMinor: input.amountMinor, currency: input.currency, egpAmountMinor, exchangeRate, source: 'manual', reason: input.reason?.trim().slice(0, 500), createdById: actor.id, reversalOfId: input.reversalOfId } });
  await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId, action: 'FINANCIAL_ENTRY_CREATED', entityType: 'FINANCIAL_ENTRY', entityId: entry.id, result: 'SUCCESS', metadataJson: { type: input.type, amountMinor: input.amountMinor, currency: input.currency, egpAmountMinor, reason: input.reason } } });
  return entry.id;
}

export async function reconcileOrder(actor: Actor, orderId: string, exchangeRates: Record<string, string>): Promise<void> {
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId }, include: { futOrder: true, financialEntries: true } });
  assert(order, 404, 'Order not found', 'ORDER_NOT_FOUND');
  assert(order.status === OrderStatus.COMPLETED, 409, 'Only completed orders can be reconciled');
  assert(order.futOrder?.actualCostMinor != null, 400, 'Actual FUT cost is required');
  if (order.reconciledAt) return;
  const lines: Array<{ type: FinancialEntryType; amountMinor: number; currency: string }> = [
    { type: FinancialEntryType.REVENUE, amountMinor: order.grossSaleMinor, currency: order.saleCurrency },
    ...(order.marketplaceFeeMinor ? [{ type: FinancialEntryType.MARKETPLACE_FEE, amountMinor: order.marketplaceFeeMinor, currency: order.saleCurrency }] : []),
    ...(order.paymentFxFeeMinor ? [{ type: FinancialEntryType.FX_FEE, amountMinor: order.paymentFxFeeMinor, currency: order.saleCurrency }] : []),
    { type: FinancialEntryType.FUT_COST, amountMinor: order.futOrder.actualCostMinor, currency: order.futOrder.actualCostCurrency ?? order.saleCurrency },
    ...(order.refundMinor ? [{ type: FinancialEntryType.REFUND, amountMinor: order.refundMinor, currency: order.saleCurrency }] : [])
  ];
  await db.$transaction(async (tx) => {
    const locked = await tx.order.updateMany({ where: { id: order.id, reconciledAt: null }, data: { reconciledAt: new Date() } });
    if (!locked.count) return;
    for (const line of lines) {
      const rate = line.currency === 'EGP' ? '1' : exchangeRates[line.currency];
      await tx.financialEntry.create({ data: { organizationId: actor.organizationId, orderId, type: line.type, amountMinor: line.amountMinor, currency: line.currency, egpAmountMinor: rate ? convertMinorToEgp(line.amountMinor, rate) : undefined, exchangeRate: rate ? new Prisma.Decimal(rate) : undefined, source: 'reconciliation', createdById: actor.id } });
    }
    await tx.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId, action: 'ORDER_RECONCILED', entityType: 'ORDER', entityId: orderId, result: 'SUCCESS', metadataJson: { entries: lines.map((line) => ({ type: line.type, amountMinor: line.amountMinor, currency: line.currency })) } } });
  });
}

export async function orderProfit(orderId: string, organizationId: string): Promise<{ original: number; egp: number }> {
  const entries = await db.financialEntry.findMany({ where: { orderId, organizationId }, orderBy: { createdAt: 'asc' } });
  return {
    original: calculateProfit(entries.map((entry) => ({ type: entry.type, amountMinor: entry.amountMinor, currency: entry.currency, egpAmountMinor: entry.egpAmountMinor ?? undefined }))),
    egp: calculateProfit(entries.map((entry) => ({ type: entry.type, amountMinor: entry.amountMinor, currency: entry.currency, egpAmountMinor: entry.egpAmountMinor ?? undefined })), true)
  };
}

export async function applyRefund(actor: Actor, orderId: string, input: { amountMinor: number; currency: string; exchangeRate: string; reason: string }): Promise<void> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  assert(input.amountMinor > 0 && Number.isSafeInteger(input.amountMinor), 400, 'Refund amount must be a positive integer minor unit');
  assert(/^[A-Z]{3}$/.test(input.currency), 400, 'Currency must be a three-letter ISO code');
  assert(input.reason.trim().length >= 3, 400, 'Refund reason is required');
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId } });
  assert(order, 404, 'Order not found', 'ORDER_NOT_FOUND');
  assert(order.status !== OrderStatus.REFUNDED, 409, 'Order is already refunded', 'ORDER_ALREADY_REFUNDED');
  assertTransition(order.status, OrderStatus.REFUNDED);
  const closedAt = order.closedAt ?? new Date();
  const egpAmountMinor = convertMinorToEgp(input.amountMinor, input.exchangeRate);
  const reason = input.reason.trim().slice(0, 500);
  await db.$transaction(async (tx) => {
    const locked = await tx.order.updateMany({ where: { id: order.id, organizationId: actor.organizationId, version: order.version, status: order.status }, data: { status: OrderStatus.REFUNDED, closedAt, version: { increment: 1 } } });
    if (!locked.count) throw new AppError(409, 'Order changed; reload before refunding', 'ORDER_VERSION_CONFLICT');
    const entry = await tx.financialEntry.create({ data: { organizationId: actor.organizationId, orderId, type: FinancialEntryType.REFUND, amountMinor: input.amountMinor, currency: input.currency, egpAmountMinor, exchangeRate: new Prisma.Decimal(input.exchangeRate), source: 'manual-refund', reason, createdById: actor.id } });
    await tx.customerCredential.updateMany({ where: { orderId, deletedAt: null }, data: { deletionDueAt: closureDeletionDate(closedAt) } });
    await tx.orderStatusHistory.create({ data: { orderId, previous: order.status, next: OrderStatus.REFUNDED, actorId: actor.id, reason, source: 'manual-refund' } });
    await tx.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId, action: 'FINANCIAL_ENTRY_CREATED', entityType: 'FINANCIAL_ENTRY', entityId: entry.id, result: 'SUCCESS', metadataJson: { type: FinancialEntryType.REFUND, amountMinor: input.amountMinor, currency: input.currency, egpAmountMinor, reason } } });
    await tx.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId, action: 'ORDER_STATUS_CHANGED', entityType: 'ORDER', entityId: order.id, result: 'SUCCESS', metadataJson: { previous: order.status, next: OrderStatus.REFUNDED, reason, source: 'manual-refund' } } });
    if (!order.assignedWorkerId) return;
    const sourcePeriod = await tx.payrollPeriod.findFirst({ where: { organizationId: actor.organizationId, monthStart: { lte: closedAt }, monthEnd: { gt: closedAt }, status: { in: [PayrollStatus.APPROVED, PayrollStatus.PAID] } } });
    if (!sourcePeriod) return;
    const nextStart = new Date(Date.UTC(sourcePeriod.monthStart.getUTCFullYear(), sourcePeriod.monthStart.getUTCMonth() + 1, 1));
    const nextEnd = new Date(Date.UTC(nextStart.getUTCFullYear(), nextStart.getUTCMonth() + 1, 1));
    const nextPeriod = await tx.payrollPeriod.upsert({ where: { organizationId_monthStart: { organizationId: actor.organizationId, monthStart: nextStart } }, create: { organizationId: actor.organizationId, monthStart: nextStart, monthEnd: nextEnd }, update: {} });
    if (nextPeriod.status !== PayrollStatus.DRAFT) return;
    await tx.payrollAdjustment.upsert({ where: { payrollPeriodId_orderId: { payrollPeriodId: nextPeriod.id, orderId } }, create: { organizationId: actor.organizationId, payrollPeriodId: nextPeriod.id, workerId: order.assignedWorkerId, orderId, completedOrderDelta: -1, reason: `Refund reversal: ${reason}`, createdById: actor.id }, update: {} });
    await tx.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId, action: 'PAYROLL_REFUND_REVERSAL_CREATED', entityType: 'PAYROLL_ADJUSTMENT', result: 'SUCCESS', metadataJson: { payrollPeriodId: nextPeriod.id, completedOrderDelta: -1 } } });
  });
}
