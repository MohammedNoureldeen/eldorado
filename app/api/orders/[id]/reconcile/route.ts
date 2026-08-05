import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { reconcileOrder } from '@/lib/ledger';
import { readJson } from '@/lib/api';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); assertCsrf(request, session); const input = await readJson<{ exchangeRates?: Record<string, string> }>(request); await reconcileOrder(session.user, params.id, input.exchangeRates ?? { EGP: '1' }); return NextResponse.json({ ok: true }); } catch (error) { return errorResponse(error); }
}
