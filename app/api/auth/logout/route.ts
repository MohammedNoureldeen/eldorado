import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, clearAuthCookies, requireSession, revokeSession } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request);
    assertCsrf(request, session);
    await revokeSession(request);
    const response = NextResponse.json({ ok: true });
    clearAuthCookies(response);
    return response;
  } catch (error) { return errorResponse(error); }
}
