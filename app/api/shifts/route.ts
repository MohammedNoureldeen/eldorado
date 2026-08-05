import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { clockIn, clockOut, currentShift, startBreak, endBreak } from '@/lib/shifts';
import { readJson } from '@/lib/api';

export async function GET(request: NextRequest) {
  try { const session = await requireSession(request); return NextResponse.json({ shift: await currentShift(session.user) }); } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request); assertCsrf(request, session);
    const input = await readJson<{ action: 'CLOCK_IN' | 'CLOCK_OUT' | 'BREAK_START' | 'BREAK_END' }>(request);
    const result = input.action === 'CLOCK_IN' ? await clockIn(session.user) : input.action === 'CLOCK_OUT' ? await clockOut(session.user) : input.action === 'BREAK_START' ? await startBreak(session.user) : await endBreak(session.user);
    return NextResponse.json(result);
  } catch (error) { return errorResponse(error); }
}
