import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { syncFutOrder } from '@/lib/orders/service';
import { defaultFutProvider } from '@/lib/integrations/fut';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try { const session = await requireSession(request); assertCsrf(request, session); await syncFutOrder(session.user, params.id, defaultFutProvider()); return NextResponse.json({ ok: true }); } catch (error) { return errorResponse(error); }
}
