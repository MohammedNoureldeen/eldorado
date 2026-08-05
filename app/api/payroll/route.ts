import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { buildPayrollDraft, payrollSummary } from '@/lib/payroll';
import { readJson } from '@/lib/api';

export async function POST(request: NextRequest) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); assertCsrf(request, session); const input = await readJson<{ month: string }>(request); return NextResponse.json(await buildPayrollDraft(session.user, input.month), { status: 201 }); } catch (error) { return errorResponse(error); }
}

export async function GET(request: NextRequest) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); const id = new URL(request.url).searchParams.get('id'); if (!id) return Response.json({ error: 'id is required' }, { status: 400 }); return NextResponse.json(await payrollSummary(session.user, id)); } catch (error) { return errorResponse(error); }
}
