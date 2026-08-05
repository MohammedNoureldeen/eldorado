import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors';
import { requireSession } from '@/lib/auth/session';
import { summaryReport } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try { const session = await requireSession(request); const url = new URL(request.url); return NextResponse.json(await summaryReport(session.user, url.searchParams.get('from') ?? undefined, url.searchParams.get('to') ?? undefined)); } catch (error) { return errorResponse(error); }
}
