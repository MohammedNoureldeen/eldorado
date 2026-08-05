import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { revokeWorkerSessions } from '@/lib/admin';

export async function POST(request: NextRequest) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); assertCsrf(request, session); const body = await request.json() as { workerId?: string }; if (!body.workerId) return Response.json({ error: 'workerId is required' }, { status: 400 }); return NextResponse.json({ revoked: await revokeWorkerSessions(session.user, body.workerId) }); } catch (error) { return errorResponse(error); }
}
