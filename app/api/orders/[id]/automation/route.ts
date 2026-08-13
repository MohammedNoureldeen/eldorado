import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { attemptAutomatedFutOrder } from '@/lib/automation';
import { errorResponse } from '@/lib/errors';
import { defaultFutProvider } from '@/lib/integrations/fut';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); assertCsrf(request, session); return NextResponse.json(await attemptAutomatedFutOrder(session.user, params.id, defaultFutProvider())); } catch (error) { return errorResponse(error); }
}
