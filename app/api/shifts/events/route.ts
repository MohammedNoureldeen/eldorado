import { NextRequest, NextResponse } from 'next/server';
import { ShiftEventType, UserRole } from '@prisma/client';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { heartbeat, disconnect, correctShift } from '@/lib/shifts';
import { readJson } from '@/lib/api';

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request); assertCsrf(request, session);
    const input = await readJson<{ type: 'HEARTBEAT' | 'DISCONNECT' | 'ADMIN_CORRECTION'; shiftId?: string; correctionType?: ShiftEventType; reason?: string }>(request);
    if (input.type === 'ADMIN_CORRECTION') {
      if (session.user.role !== UserRole.OWNER_ADMIN || !input.shiftId || !input.correctionType || !input.reason) return Response.json({ error: 'Admin correction requires shift, event type, and reason' }, { status: 400 });
      return NextResponse.json(await correctShift(session.user, input.shiftId, input.correctionType, input.reason));
    }
    return NextResponse.json(input.type === 'HEARTBEAT' ? await heartbeat(session.user) : await disconnect(session.user));
  } catch (error) { return errorResponse(error); }
}
