import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { confirmFutOrder } from '@/lib/orders/service';
import { defaultFutProvider } from '@/lib/integrations/fut';
import { readJson } from '@/lib/api';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try { const session = await requireSession(request); assertCsrf(request, session); const input = await readJson<{ expectedVersion: number }>(request); await confirmFutOrder(session.user, params.id, input.expectedVersion, defaultFutProvider()); return NextResponse.json({ ok: true }); } catch (error) { return errorResponse(error); }
}
