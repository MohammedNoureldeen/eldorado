import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { listSettings, updateSettings } from '@/lib/settings';
import { readJson } from '@/lib/api';

export async function GET(request: NextRequest) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); return NextResponse.json(await listSettings(session.user)); } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: NextRequest) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); assertCsrf(request, session); await updateSettings(session.user, await readJson<Record<string, unknown>>(request)); return NextResponse.json({ ok: true }); } catch (error) { return errorResponse(error); }
}
