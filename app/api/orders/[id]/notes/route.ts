import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { addOrderNote } from '@/lib/order-notes';
import { readJson } from '@/lib/api';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try { const session = await requireSession(request); assertCsrf(request, session); const input = await readJson<{ body: string }>(request); return NextResponse.json({ id: await addOrderNote(session.user, params.id, input.body) }, { status: 201 }); } catch (error) { return errorResponse(error); }
}

