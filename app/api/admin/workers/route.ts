import { NextRequest, NextResponse } from 'next/server';
import { UserStatus, UserRole } from '@prisma/client';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { createWorker, listWorkers, updateWorker } from '@/lib/admin';
import { readJson } from '@/lib/api';

export async function GET(request: NextRequest) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); return NextResponse.json({ workers: await listWorkers(session.user) }); } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); assertCsrf(request, session); return NextResponse.json(await createWorker(session.user, await readJson<{ name: string; email: string; password: string; telegramChatId?: string }>(request)), { status: 201 }); } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: NextRequest) {
  try { const session = await requireSession(request, [UserRole.OWNER_ADMIN]); assertCsrf(request, session); const input = await readJson<{ workerId: string; status?: UserStatus; name?: string; telegramChatId?: string | null; scheduleJson?: unknown; salaryPolicyId?: string | null }>(request); await updateWorker(session.user, input.workerId, input); return NextResponse.json({ ok: true }); } catch (error) { return errorResponse(error); }
}
