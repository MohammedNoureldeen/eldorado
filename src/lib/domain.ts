import { createHash } from 'node:crypto';

export const ORDER_STATUSES = ['DRAFT', 'WAITING_FOR_DETAILS', 'READY_FOR_REVIEW', 'APPROVED', 'SUBMITTED_TO_FUT', 'PROCESSING', 'CUSTOMER_ACTION_REQUIRED', 'COMPLETED', 'FAILED', 'CANCELLED', 'DISPUTED', 'REFUNDED'] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];
export type Platform = 'PC' | 'PLAYSTATION' | 'XBOX';

const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ['WAITING_FOR_DETAILS', 'READY_FOR_REVIEW', 'CANCELLED'],
  WAITING_FOR_DETAILS: ['READY_FOR_REVIEW', 'DRAFT', 'CANCELLED'],
  READY_FOR_REVIEW: ['APPROVED', 'COMPLETED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['SUBMITTED_TO_FUT', 'COMPLETED', 'CANCELLED'],
  SUBMITTED_TO_FUT: ['PROCESSING', 'CUSTOMER_ACTION_REQUIRED', 'COMPLETED', 'FAILED', 'CANCELLED'],
  PROCESSING: ['CUSTOMER_ACTION_REQUIRED', 'COMPLETED', 'FAILED', 'DISPUTED'],
  CUSTOMER_ACTION_REQUIRED: ['PROCESSING', 'COMPLETED', 'FAILED', 'DISPUTED'],
  COMPLETED: ['DISPUTED', 'REFUNDED'],
  FAILED: ['READY_FOR_REVIEW', 'CANCELLED', 'REFUNDED'],
  CANCELLED: ['READY_FOR_REVIEW', 'REFUNDED'],
  DISPUTED: ['COMPLETED', 'REFUNDED'],
  REFUNDED: []
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || transitions[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new Error(`Invalid order transition: ${from} -> ${to}`);
}

export type LedgerLine = { type: 'REVENUE' | 'MARKETPLACE_FEE' | 'FUT_COST' | 'REFUND' | 'FX_FEE' | 'ADJUSTMENT'; amountMinor: number; currency: string; egpAmountMinor?: number };

export function calculateProfit(lines: LedgerLine[], egp = false): number {
  const sign: Record<LedgerLine['type'], number> = { REVENUE: 1, MARKETPLACE_FEE: -1, FUT_COST: -1, REFUND: -1, FX_FEE: -1, ADJUSTMENT: 1 };
  return lines.reduce((total, line) => total + sign[line.type] * (egp ? (line.egpAmountMinor ?? 0) : line.amountMinor), 0);
}

export type SalaryTier = { name: string; minCompleted: number; baseSalaryMinor: number };
export type SalaryPolicyInput = { tiers: SalaryTier[]; bonusInterval: number; bonusAmountMinor: number };

export function calculatePayroll(completedCleanOrders: number, policy: SalaryPolicyInput): { tier: string; baseSalaryMinor: number; bonusMinor: number; finalAmountMinor: number } {
  if (!Number.isInteger(completedCleanOrders) || completedCleanOrders < 0) throw new Error('Completed order count must be a non-negative integer');
  const tier = [...policy.tiers].sort((a, b) => b.minCompleted - a.minCompleted).find((item) => completedCleanOrders >= item.minCompleted);
  if (!tier) throw new Error('Salary policy has no applicable tier');
  const bonus = completedCleanOrders >= 250 ? Math.floor((completedCleanOrders - 250) / policy.bonusInterval) * policy.bonusAmountMinor : 0;
  return { tier: tier.name, baseSalaryMinor: tier.baseSalaryMinor, bonusMinor: bonus, finalAmountMinor: tier.baseSalaryMinor + bonus };
}

export function calculateHandlingRateBps(assignedValidOrders: number, completedCleanOrders: number): number {
  return assignedValidOrders <= 0 ? 0 : Math.round((completedCleanOrders / assignedValidOrders) * 10_000);
}

export function payrollOrderCounts(completedOrders: number, assignedValidOrders: number, completedOrderAdjustment: number): { completedCleanOrders: number; assignedValidOrders: number; handlingRateBps: number } {
  const completedCleanOrders = Math.max(0, completedOrders + completedOrderAdjustment);
  const validOrders = Math.max(completedCleanOrders, assignedValidOrders);
  return { completedCleanOrders, assignedValidOrders: validOrders, handlingRateBps: calculateHandlingRateBps(validOrders, completedCleanOrders) };
}

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== 'object') return value;
  const sensitive = /password|credential|backup.?code|secret|token|authorization|api.?key/i;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, sensitive.test(key) ? '[REDACTED]' : redactSensitive(child)]));
}

export function closureDeletionDate(closedAt: Date, days = 7): Date {
  const date = new Date(closedAt);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export const minimumCoinQuantity = 200_000;

export function formatOrderReference(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error('Invalid order-reference year');
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 999_999) throw new Error('Invalid order-reference sequence');
  return `ELD-${year}-${String(sequence).padStart(6, '0')}`;
}

export function normalizeMarketplaceReference(value?: string | null): string | null {
  const normalized = value?.trim().replace(/\s+/g, ' ').toUpperCase() ?? '';
  return normalized || null;
}

export function normalizeCustomerName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function createCustomerFingerprint(organizationId: string, customerName: string): string {
  const normalized = normalizeCustomerName(customerName).toLocaleLowerCase('en-US').normalize('NFKC');
  return createHash('sha256').update(`${organizationId}\u0000${normalized}`).digest('hex');
}

export function basisPointAmount(amountMinor: number, rateBps: number): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error('Amount must be non-negative integer minor units');
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) throw new Error('Basis-point rate must be between 0 and 10000');
  return Math.round((amountMinor * rateBps) / 10_000);
}

export function splitShiftMinutes(events: { type: string; occurredAt: Date }[]): { connectedMinutes: number; breakMinutes: number; unexplainedGapMinutes: number } {
  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  let connected = 0, breaks = 0, gaps = 0;
  let state: 'off' | 'connected' | 'break' = 'off';
  let last: Date | undefined;
  for (const event of sorted) {
    if (last) {
      const minutes = Math.max(0, Math.round((event.occurredAt.getTime() - last.getTime()) / 60_000));
      if (state === 'connected') connected += minutes;
      if (state === 'break') breaks += minutes;
      if (state === 'off' && minutes > 2) gaps += minutes;
    }
    if (event.type === 'CLOCK_IN' || event.type === 'RECONNECT') state = 'connected';
    if (event.type === 'BREAK_START') state = 'break';
    if (event.type === 'BREAK_END') state = 'connected';
    if (event.type === 'DISCONNECT' || event.type === 'CLOCK_OUT') state = 'off';
    last = event.occurredAt;
  }
  return { connectedMinutes: connected, breakMinutes: breaks, unexplainedGapMinutes: gaps };
}
