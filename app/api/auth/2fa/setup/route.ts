import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { errorResponse } from '@/lib/errors';
import { requireSession, assertCsrf } from '@/lib/auth/session';
import { generateBase32Secret } from '@/lib/auth/totp';
import { encryptSecret } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request, [UserRole.OWNER_ADMIN]);
    assertCsrf(request, session);
    const secret = generateBase32Secret();
    await db.user.update({ where: { id: session.user.id }, data: { twoFactorSecret: encryptSecret(secret), twoFactorEnabled: false } });
    const label = encodeURIComponent(`Eldorado:${session.user.email}`);
    return NextResponse.json({ secret, otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=Eldorado` });
  } catch (error) { return errorResponse(error); }
}
