import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { errorResponse } from '@/lib/errors';
import { rotateCredentialEncryption } from '@/lib/security/credential-maintenance';

export async function POST(request: NextRequest) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); assertCsrf(request, session); return NextResponse.json(await rotateCredentialEncryption(session.user)); } catch (error) { return errorResponse(error); }
}
