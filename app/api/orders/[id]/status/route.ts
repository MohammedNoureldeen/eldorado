import { NextRequest, NextResponse } from 'next/server';
import { OrderStatus } from '@prisma/client';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { changeOrderStatus } from '@/lib/orders/service';
import { readJson } from '@/lib/api';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try { const session = await requireSession(request); assertCsrf(request, session); const input = await readJson<{ status: OrderStatus; version: number; reason: string }>(request); await changeOrderStatus(session.user, params.id, input.status, input.version, input.reason); return NextResponse.json({ ok: true }); } catch (error) { return errorResponse(error); }
}
