import { OrderStatus, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { AppError, assert } from '@/lib/errors';
import { calculateProfit } from '@/lib/domain';
import { AuthUser, assertRole } from '@/lib/auth/rbac';

type Actor = Pick<AuthUser, 'id' | 'organizationId' | 'role'>;

export async function summaryReport(actor: Actor, from?: string, to?: string): Promise<unknown> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const start = from ? new Date(from) : new Date(new Date().setUTCHours(0, 0, 0, 0));
  const end = to ? new Date(to) : new Date();
  const entries = await db.financialEntry.findMany({ where: { organizationId: actor.organizationId, createdAt: { gte: start, lte: end } }, select: { type: true, amountMinor: true, currency: true, egpAmountMinor: true } });
  const orders = await db.order.groupBy({ by: ['status'], where: { organizationId: actor.organizationId, createdAt: { gte: start, lte: end } }, _count: { _all: true } });
  const workersOnline = await db.shift.count({ where: { organizationId: actor.organizationId, status: 'OPEN' } });
  const ledgerLines = entries.map((entry) => ({ ...entry, egpAmountMinor: entry.egpAmountMinor ?? undefined }));
  return { period: { from: start.toISOString(), to: end.toISOString() }, ordersByStatus: Object.fromEntries(orders.map((row) => [row.status, row._count._all])), workersOnline, profit: { original: calculateProfit(ledgerLines), egp: calculateProfit(ledgerLines, true) }, entryCount: entries.length };
}

export async function exportOrdersCsv(actor: Actor, from?: string, to?: string): Promise<string> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const orders = await db.order.findMany({ where: { organizationId: actor.organizationId, createdAt: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } }, include: { assignedWorker: { select: { name: true } }, financialEntries: { select: { type: true, amountMinor: true, currency: true, egpAmountMinor: true } } }, orderBy: { createdAt: 'asc' } });
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['order_id', 'eldorado_order_id', 'platform', 'status', 'worker', 'sale_minor', 'currency', 'profit_egp_minor', 'created_at']];
  for (const order of orders) rows.push([order.id, order.eldoradoOrderId, order.platform, order.status, order.assignedWorker?.name ?? '', String(order.grossSaleMinor), order.saleCurrency, String(calculateProfit(order.financialEntries.map((entry) => ({ ...entry, egpAmountMinor: entry.egpAmountMinor ?? undefined })), true)), order.createdAt.toISOString()]);
  return rows.map((row) => row.map(escape).join(',')).join('\n');
}
