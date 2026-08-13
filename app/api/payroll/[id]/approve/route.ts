import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { approvePayroll, markPayrollPaid } from '@/lib/payroll';
import { readJson } from '@/lib/api';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); assertCsrf(request, session); const input = await readJson<{ action: 'APPROVE' | 'PAID' }>(request); if (input.action === 'PAID') await markPayrollPaid(session.user, params.id); else await approvePayroll(session.user, params.id); return NextResponse.json({ ok: true }); } catch (error) { return errorResponse(error); }
}

