import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { readJson } from '@/lib/api';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { economyConfiguration, updateMarketplaceFee } from '@/lib/admin-economy';
import { errorResponse } from '@/lib/errors';

export async function GET(request: NextRequest) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); return NextResponse.json(await economyConfiguration(session.user)); } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: NextRequest) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); assertCsrf(request, session); const input = await readJson<{ feeBps: number }>(request); await updateMarketplaceFee(session.user, input.feeBps); return NextResponse.json({ ok: true }); } catch (error) { return errorResponse(error); }
}
