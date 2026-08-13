import { NextRequest, NextResponse } from 'next/server';
import { FinancialEntryType, UserRole } from '@prisma/client';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { addFinancialEntry, applyRefund } from '@/lib/ledger';
import { readJson } from '@/lib/api';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); assertCsrf(request, session); const input = await readJson<{ type: FinancialEntryType; amountMinor: number; currency: string; egpAmountMinor?: number; exchangeRate?: string; reason?: string; reversalOfId?: string }>(request); if (input.type === FinancialEntryType.REFUND) { await applyRefund(session.user, params.id, { amountMinor: input.amountMinor, currency: input.currency, exchangeRate: input.exchangeRate ?? '1', reason: input.reason ?? 'Manual refund' }); return NextResponse.json({ ok: true }, { status: 201 }); } const id = await addFinancialEntry(session.user, params.id, input); return NextResponse.json({ id }, { status: 201 }); } catch (error) { return errorResponse(error); }
}

