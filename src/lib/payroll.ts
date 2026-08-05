import { OrderStatus, PayrollStatus, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { AppError, assert } from '@/lib/errors';
import { calculateHandlingRateBps, calculatePayroll, SalaryPolicyInput } from '@/lib/domain';
import { AuthUser, assertRole } from '@/lib/auth/rbac';

const defaultPolicy: SalaryPolicyInput = { tiers: [{ name: 'under-200', minCompleted: 0, baseSalaryMinor: 300_000 }, { name: '200-249', minCompleted: 200, baseSalaryMinor: 350_000 }, { name: '250+', minCompleted: 250, baseSalaryMinor: 500_000 }], bonusInterval: 10, bonusAmountMinor: 15_000 };

type Actor = Pick<AuthUser, 'id' | 'organizationId' | 'role'>;

function monthRange(month: string): { start: Date; end: Date } {
  assert(/^\d{4}-\d{2}$/.test(month), 400, 'Payroll month must be YYYY-MM');
  const [year, monthNumber] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));
  return { start, end };
}

async function policyFor(organizationId: string, at: Date): Promise<SalaryPolicyInput> {
  const policy = await db.salaryPolicy.findFirst({ where: { organizationId, active: true, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] }, orderBy: { effectiveFrom: 'desc' } });
  if (!policy) return defaultPolicy;
  const tiers = Array.isArray(policy.tiersJson) ? policy.tiersJson as unknown as SalaryPolicyInput['tiers'] : defaultPolicy.tiers;
  return { tiers, bonusInterval: policy.bonusInterval, bonusAmountMinor: policy.bonusAmountMinor };
}

export async function buildPayrollDraft(actor: Actor, month: string): Promise<{ id: string }> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const { start, end } = monthRange(month);
  const period = await db.payrollPeriod.upsert({ where: { organizationId_monthStart: { organizationId: actor.organizationId, monthStart: start } }, create: { organizationId: actor.organizationId, monthStart: start, monthEnd: end }, update: {} });
  assert(period.status === PayrollStatus.DRAFT, 409, 'Only draft payroll periods can be rebuilt', 'PAYROLL_IMMUTABLE');
  const policy = await policyFor(actor.organizationId, start);
  const workers = await db.user.findMany({ where: { organizationId: actor.organizationId, role: UserRole.WORKER }, select: { id: true } });
  const completed = await db.order.findMany({ where: { organizationId: actor.organizationId, status: OrderStatus.COMPLETED, reconciledAt: { not: null }, closedAt: { gte: start, lt: end } }, select: { assignedWorkerId: true } });
  const validByWorker = new Map<string, number>();
  for (const order of completed) if (order.assignedWorkerId) validByWorker.set(order.assignedWorkerId, (validByWorker.get(order.assignedWorkerId) ?? 0) + 1);
  const adjustments = await db.payrollAdjustment.findMany({ where: { payrollPeriodId: period.id }, select: { workerId: true, completedOrderDelta: true, amountMinor: true } });
  const adjustmentsByWorker = new Map<string, { completedOrderDelta: number; amountMinor: number }>();
  for (const adjustment of adjustments) {
    const current = adjustmentsByWorker.get(adjustment.workerId) ?? { completedOrderDelta: 0, amountMinor: 0 };
    current.completedOrderDelta += adjustment.completedOrderDelta; current.amountMinor += adjustment.amountMinor; adjustmentsByWorker.set(adjustment.workerId, current);
  }
  await db.$transaction(async (tx) => {
    await tx.payrollEntry.deleteMany({ where: { payrollPeriodId: period.id } });
    for (const worker of workers) {
      const adjustment = adjustmentsByWorker.get(worker.id) ?? { completedOrderDelta: 0, amountMinor: 0 };
      const completedCleanOrders = Math.max(0, (validByWorker.get(worker.id) ?? 0) + adjustment.completedOrderDelta);
      const result = calculatePayroll(completedCleanOrders, policy);
      await tx.payrollEntry.create({ data: { payrollPeriodId: period.id, workerId: worker.id, completedCleanOrders, assignedValidOrders: completedCleanOrders, handlingRateBps: calculateHandlingRateBps(completedCleanOrders, completedCleanOrders), tier: result.tier, baseSalaryMinor: result.baseSalaryMinor, bonusMinor: result.bonusMinor, adjustmentsMinor: adjustment.amountMinor, finalAmountMinor: result.finalAmountMinor + adjustment.amountMinor } });
    }
    await tx.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action: 'PAYROLL_DRAFT_BUILT', entityType: 'PAYROLL_PERIOD', entityId: period.id, result: 'SUCCESS', metadataJson: { month, workerCount: workers.length } } });
  });
  return { id: period.id };
}

export async function approvePayroll(actor: Actor, payrollId: string): Promise<void> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const result = await db.payrollPeriod.updateMany({ where: { id: payrollId, organizationId: actor.organizationId, status: PayrollStatus.DRAFT }, data: { status: PayrollStatus.APPROVED, approvedById: actor.id, approvedAt: new Date() } });
  if (!result.count) throw new AppError(409, 'Payroll is not a draft or does not exist', 'PAYROLL_IMMUTABLE');
  await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action: 'PAYROLL_APPROVED', entityType: 'PAYROLL_PERIOD', entityId: payrollId, result: 'SUCCESS' } });
}

export async function markPayrollPaid(actor: Actor, payrollId: string): Promise<void> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const result = await db.payrollPeriod.updateMany({ where: { id: payrollId, organizationId: actor.organizationId, status: PayrollStatus.APPROVED }, data: { status: PayrollStatus.PAID, paidAt: new Date() } });
  if (!result.count) throw new AppError(409, 'Only approved payroll can be marked paid', 'PAYROLL_IMMUTABLE');
}

export async function payrollSummary(actor: Actor, payrollId: string): Promise<unknown> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const period = await db.payrollPeriod.findFirst({ where: { id: payrollId, organizationId: actor.organizationId }, include: { entries: { include: { worker: { select: { id: true, name: true, email: true } } } } } });
  assert(period, 404, 'Payroll period not found');
  return period;
}
