import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors';
import { requireSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireSession(request);
    return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status, workerProfile: user.workerProfile ? { telegramChatId: user.workerProfile.telegramChatId } : null } });
  } catch (error) { return errorResponse(error); }
}
