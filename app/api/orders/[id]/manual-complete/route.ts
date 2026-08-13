import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { readJson } from '@/lib/api';
import { completeOrderManually } from '@/lib/orders/service';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    const session = await requireSession(request);
    assertCsrf(request, session);
    const input = await readJson<{ version: number; actualCostMinor: number }>(request);
    await completeOrderManually(session.user, params.id, input);
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
