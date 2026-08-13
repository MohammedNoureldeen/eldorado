import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { requireSession } from '@/lib/auth/session';
import { recentAuditEvents } from '@/lib/admin-economy';
import { errorResponse } from '@/lib/errors';

export async function GET(request: NextRequest) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); const limit = Number(new URL(request.url).searchParams.get('limit') ?? 50); return NextResponse.json({ events: await recentAuditEvents(session.user, limit) }); } catch (error) { return errorResponse(error); }
}
