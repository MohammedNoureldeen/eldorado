import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { prepareFutOrder } from '@/lib/orders/service';
import { defaultFutProvider } from '@/lib/integrations/fut';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try { const session = await requireSession(request); assertCsrf(request, session); return NextResponse.json(await prepareFutOrder(session.user, params.id, defaultFutProvider())); } catch (error) { return errorResponse(error); }
}
