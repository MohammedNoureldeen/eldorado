import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { getOrder, updateOrder } from '@/lib/orders/service';
import { readJson } from '@/lib/api';

type Context = { params: { id: string } };

export async function GET(request: NextRequest, { params }: Context) {
  try { const session = await requireSession(request); return NextResponse.json({ order: await getOrder(session.user, params.id) }); } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  try { const session = await requireSession(request); assertCsrf(request, session); const input = await readJson<{ version: number; platform?: 'PC' | 'PLAYSTATION' | 'XBOX'; coinQuantity?: number; grossSaleMinor?: number; saleCurrency?: string; deadline?: string | null; assignedWorkerId?: string | null }>(request); await updateOrder(session.user, params.id, input.version, input); return NextResponse.json({ ok: true }); } catch (error) { return errorResponse(error); }
}
