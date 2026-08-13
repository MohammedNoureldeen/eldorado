import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { requireSession } from '@/lib/auth/session';
import { errorResponse } from '@/lib/errors';
import { credentialRetentionReport } from '@/lib/security/credential-maintenance';

export async function GET(request: NextRequest) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); return NextResponse.json(await credentialRetentionReport(session.user)); } catch (error) { return errorResponse(error); }
}
