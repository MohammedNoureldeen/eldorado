import { NextRequest, NextResponse } from 'next/server';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { errorResponse } from '@/lib/errors';
import { defaultFutProvider } from '@/lib/integrations/fut';
import { correctAndResumeFutOrder } from '@/lib/orders/service';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    const session = await requireSession(request);
    assertCsrf(request, session);
    await correctAndResumeFutOrder(session.user, params.id, defaultFutProvider());
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
