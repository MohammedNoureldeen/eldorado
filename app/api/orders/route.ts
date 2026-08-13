import { NextRequest, NextResponse } from 'next/server';
import { FulfillmentSource, Platform } from '@prisma/client';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { createOrder, listOrders } from '@/lib/orders/service';
import { readJson } from '@/lib/api';

export async function GET(request: NextRequest) {
  try { const session = await requireSession(request); return NextResponse.json({ orders: await listOrders(session.user) }); } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request); assertCsrf(request, session);
    const input = await readJson<{ marketplaceReference?: string; customerName: string; platform: Platform; coinQuantity: number; grossSaleMinor: number; fulfillmentSource: FulfillmentSource; deadline?: string; assignedWorkerId?: string }>(request);
    const result = await createOrder(session.user, input);
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
