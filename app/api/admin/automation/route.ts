import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { readJson } from '@/lib/api';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { AutomationPolicy, emergencyStopAutomation, getAutomationPolicy, updateAutomationPolicy } from '@/lib/automation';
import { errorResponse } from '@/lib/errors';

export async function GET(request: NextRequest) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); return NextResponse.json(await getAutomationPolicy(session.user)); } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: NextRequest) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); assertCsrf(request, session); const input = await readJson<{ policy: AutomationPolicy; acknowledgement?: string }>(request); await updateAutomationPolicy(session.user, input.policy, input.acknowledgement); return NextResponse.json({ ok: true }); } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: NextRequest) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); assertCsrf(request, session); await emergencyStopAutomation(session.user); return NextResponse.json({ ok: true }); } catch (error) { return errorResponse(error); }
}
