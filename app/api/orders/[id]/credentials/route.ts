import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { addCredentials, deleteCredentialsNow } from '@/lib/orders/service';
import { readJson } from '@/lib/api';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try { const session = await requireSession(request); assertCsrf(request, session); const input = await readJson<{ email: string; password: string; backupCodes?: string[] }>(request); await addCredentials(session.user, params.id, input); return NextResponse.json({ ok: true }); } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try { const session = await requireSession(request); assertCsrf(request, session); await deleteCredentialsNow(session.user, params.id); return NextResponse.json({ ok: true }); } catch (error) { return errorResponse(error); }
}
