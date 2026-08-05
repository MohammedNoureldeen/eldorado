import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { errorResponse } from '@/lib/errors';
import { requireSession } from '@/lib/auth/session';
import { defaultFutProvider } from '@/lib/integrations/fut';
import { env } from '@/lib/config';
import { enqueueTelegram } from '@/lib/notifications/telegram';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); const balance = await defaultFutProvider().getBalance(); const low = balance.balanceMinor <= env.futLowBalanceMinor; if (low) await enqueueTelegram({ organizationId: session.user.organizationId, type: 'FUT_LOW_BALANCE', message: `FUT balance is low: ${balance.balanceMinor} ${balance.currency}`, dedupeKey: `fut-low-balance:${session.user.organizationId}:${new Date().toISOString().slice(0, 10)}`, critical: true }); return NextResponse.json({ ...balance, low }); } catch (error) { return errorResponse(error); }
}
