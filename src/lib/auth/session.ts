import { createHash, createHmac, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { env } from '@/lib/config';
import { AppError } from '@/lib/errors';
import { assertActive, assertRole, AuthUser } from '@/lib/auth/rbac';

const hash = (value: string) => createHmac('sha256', env.sessionCookieSecret).update(value).digest('hex');
const secure = env.nodeEnv === 'production';

export type SessionContext = { sessionId: string; user: AuthUser; csrfToken: string };

function requestIp(request: NextRequest): string | undefined {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || undefined;
}

export async function createSession(user: { id: string; organizationId: string }, request: NextRequest): Promise<{ token: string; csrfToken: string }> {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  await db.session.create({ data: {
    organizationId: user.organizationId,
    userId: user.id,
    tokenHash: hash(token),
    csrfTokenHash: hash(csrfToken),
    expiresAt: new Date(Date.now() + env.sessionTtlDays * 86_400_000),
    ipAddress: requestIp(request),
    userAgent: request.headers.get('user-agent')?.slice(0, 500)
  } });
  return { token, csrfToken };
}

export function applyAuthCookies(response: NextResponse, token: string, csrfToken: string): void {
  response.cookies.set(env.sessionCookieName, token, { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: env.sessionTtlDays * 86_400 });
  response.cookies.set('eldorado_csrf', csrfToken, { httpOnly: false, secure, sameSite: 'strict', path: '/', maxAge: env.sessionTtlDays * 86_400 });
}

export function clearAuthCookies(response: NextResponse): void {
  response.cookies.set(env.sessionCookieName, '', { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 0 });
  response.cookies.set('eldorado_csrf', '', { httpOnly: false, secure, sameSite: 'strict', path: '/', maxAge: 0 });
}

export async function getSession(request?: NextRequest): Promise<SessionContext | null> {
  const token = request?.cookies.get(env.sessionCookieName)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: hash(token) }, include: { user: { include: { workerProfile: true } } } });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  assertActive(session.user as AuthUser);
  await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  return { sessionId: session.id, user: session.user as AuthUser, csrfToken: session.csrfTokenHash };
}

export async function requireSession(request: NextRequest, roles?: UserRole[]): Promise<SessionContext> {
  const session = await getSession(request);
  if (!session) throw new AppError(401, 'Authentication required', 'UNAUTHENTICATED');
  if (roles?.length) assertRole(session.user, ...roles);
  return session;
}

export async function revokeSession(request: NextRequest): Promise<void> {
  const token = request.cookies.get(env.sessionCookieName)?.value;
  if (token) await db.session.updateMany({ where: { tokenHash: hash(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

export function assertCsrf(request: NextRequest, session: SessionContext): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const token = request.headers.get('x-csrf-token');
  if (!token || hash(token) !== session.csrfToken) throw new AppError(403, 'CSRF validation failed', 'CSRF_FAILED');
}
