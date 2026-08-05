import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { errorResponse, AppError } from '@/lib/errors';
import { requireSession, assertCsrf } from '@/lib/auth/session';
import { verifyTotp } from '@/lib/auth/totp';
import { decryptSecret } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request, [UserRole.OWNER_ADMIN]);
    assertCsrf(request, session);
    const body = await request.json() as { code?: string };
    const user = await db.user.findUniqueOrThrow({ where: { id: session.user.id } });
    if (!user.twoFactorSecret || !body.code || !verifyTotp(decryptSecret(user.twoFactorSecret), body.code)) throw new AppError(400, 'Invalid verification code', 'INVALID_2FA');
    await db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
