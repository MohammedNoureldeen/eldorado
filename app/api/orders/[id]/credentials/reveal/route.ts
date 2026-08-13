import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { revealCredentials } from '@/lib/orders/service';
import { requestIp, readJson } from '@/lib/api';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try { const session = await requireSession(request); assertCsrf(request, session); const input = await readJson<{ reason: string }>(request); const result = await revealCredentials(session.user, params.id, input.reason, requestIp(request)); return NextResponse.json(result, { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } }); } catch (error) { return errorResponse(error); }
}

