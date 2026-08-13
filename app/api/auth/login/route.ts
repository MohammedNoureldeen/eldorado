import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { errorResponse, AppError } from '@/lib/errors';
import { verifyPassword } from '@/lib/auth/password';
import { verifyTotp } from '@/lib/auth/totp';
import { createSession, applyAuthCookies } from '@/lib/auth/session';
import { decryptSecret } from '@/lib/crypto/secrets';
import { checkSharedRateLimit } from '@/lib/security/rate-limit';
import { requestIp, readJson } from '@/lib/api';

export async function POST(request: NextRequest) {
  try {
    const input = await readJson<{ email?: string; password?: string; otp?: string }>(request);
    const email = input.email?.trim().toLowerCase() ?? '';
    const password = input.password ?? '';
    const ip = requestIp(request) ?? 'unknown';
    const rate = await checkSharedRateLimit(`login:${ip}:${email}`, 10, 15 * 60_000);
    if (!rate.allowed) return NextResponse.json({ error: 'Too many login attempts' }, { status: 429, headers: { 'retry-after': String(rate.retryAfterSeconds) } });
    const user = await db.user.findFirst({ where: { email }, include: { workerProfile: true } });
    if (!user || user.status !== 'ACTIVE' || !(await verifyPassword(user.passwordHash, password).catch(() => false))) throw new AppError(401, 'Invalid email or password', 'INVALID_LOGIN');
    if (user.twoFactorEnabled) {
      if (!input.otp || !user.twoFactorSecret || !verifyTotp(decryptSecret(user.twoFactorSecret), input.otp)) throw new AppError(401, 'A valid administrator verification code is required', 'INVALID_2FA');
    }
    const session = await createSession(user, request);
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await db.auditEvent.create({ data: { organizationId: user.organizationId, actorId: user.id, action: 'LOGIN', entityType: 'SESSION', result: 'SUCCESS', ipAddress: ip } });
    const response = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, csrfToken: session.csrfToken });
    applyAuthCookies(response, session.token, session.csrfToken);
    return response;
  } catch (error) { return errorResponse(error); }
}
