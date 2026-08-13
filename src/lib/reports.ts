import { FinancialEntryType, OrderStatus, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { AppError, assert } from '@/lib/errors';
import { calculateProfit } from '@/lib/domain';
import { AuthUser, assertRole } from '@/lib/auth/rbac';

type Actor = Pick<AuthUser, 'id' | 'organizationId' | 'role'>;

type ReportEntry = { type: FinancialEntryType; amountMinor: number; currency: string; egpAmountMinor?: number };

export function summarizeUsdLedger(entries: ReportEntry[]) {
  const usdEntries = entries.filter((entry) => entry.currency === 'USD');
  const sum = (type: FinancialEntryType) => usdEntries.filter((entry) => entry.type === type).reduce((total, entry) => total + entry.amountMinor, 0);
  return { revenueMinor: sum(FinancialEntryType.REVENUE), marketplaceFeeMinor: sum(FinancialEntryType.MARKETPLACE_FEE), futCostMinor: sum(FinancialEntryType.FUT_COST), refundMinor: sum(FinancialEntryType.REFUND), fxFeeMinor: sum(FinancialEntryType.FX_FEE), adjustmentMinor: sum(FinancialEntryType.ADJUSTMENT), profitMinor: calculateProfit(usdEntries), entryCount: entries.length, nonUsdEntryCount: entries.length - usdEntries.length };
}

export async function summaryReport(actor: Actor, from?: string, to?: string): Promise<unknown> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const start = from ? new Date(from) : new Date(new Date().setUTCHours(0, 0, 0, 0));
  const end = to ? new Date(to) : new Date();
  assert(!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= end, 400, 'Invalid report period');
  const entries = await db.financialEntry.findMany({ where: { organizationId: actor.organizationId, createdAt: { gte: start, lte: end } }, select: { type: true, amountMinor: true, currency: true, egpAmountMinor: true } });
  const orders = await db.order.groupBy({ by: ['status'], where: { organizationId: actor.organizationId, createdAt: { gte: start, lte: end } }, _count: { _all: true } });
  const workersOnline = await db.shift.count({ where: { organizationId: actor.organizationId, status: 'OPEN' } });
  const ledgerLines = entries.map((entry) => ({ ...entry, egpAmountMinor: entry.egpAmountMinor ?? undefined }));
  const ledger = summarizeUsdLedger(ledgerLines);
  const [completedUnreconciled, unknownSubmissions, customerActions] = await Promise.all([
    db.order.count({ where: { organizationId: actor.organizationId, status: OrderStatus.COMPLETED, reconciledAt: null } }),
    db.futOrder.count({ where: { order: { organizationId: actor.organizationId }, submissionState: 'UNKNOWN' } }),
    db.order.count({ where: { organizationId: actor.organizationId, status: OrderStatus.CUSTOMER_ACTION_REQUIRED } })
  ]);
  return {
    period: { from: start.toISOString(), to: end.toISOString() },
    ordersByStatus: Object.fromEntries(orders.map((row) => [row.status, row._count._all])),
    workersOnline,
    profit: { usdMinor: ledger.profitMinor, egpMinor: calculateProfit(ledgerLines, true) },
    ledger: { revenueMinor: ledger.revenueMinor, marketplaceFeeMinor: ledger.marketplaceFeeMinor, futCostMinor: ledger.futCostMinor, refundMinor: ledger.refundMinor, fxFeeMinor: ledger.fxFeeMinor, adjustmentMinor: ledger.adjustmentMinor, entryCount: ledger.entryCount, nonUsdEntryCount: ledger.nonUsdEntryCount },
    controls: { completedUnreconciled, unknownSubmissions, customerActions }
  };
}

export async function exportOrdersCsv(actor: Actor, from?: string, to?: string): Promise<string> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const orders = await db.order.findMany({ where: { organizationId: actor.organizationId, createdAt: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } }, include: { assignedWorker: { select: { name: true } }, financialEntries: { select: { type: true, amountMinor: true, currency: true, egpAmountMinor: true } } }, orderBy: { createdAt: 'asc' } });
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['order_id', 'order_reference', 'marketplace_reference', 'platform', 'status', 'worker', 'sale_minor', 'currency', 'profit_usd_minor', 'created_at']];
  for (const order of orders) rows.push([order.id, order.orderReference, order.marketplaceReference ?? '', order.platform, order.status, order.assignedWorker?.name ?? '', String(order.grossSaleMinor), order.saleCurrency, String(calculateProfit(order.financialEntries.map((entry) => ({ ...entry, egpAmountMinor: entry.egpAmountMinor ?? undefined })))), order.createdAt.toISOString()]);
  return rows.map((row) => row.map(escape).join(',')).join('\n');
}
