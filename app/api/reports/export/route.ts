import { NextRequest } from 'next/server';
import { errorResponse } from '@/lib/errors';
import { requireSession } from '@/lib/auth/session';
import { exportOrdersCsv } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try { const session = await requireSession(request); const url = new URL(request.url); const csv = await exportOrdersCsv(session.user, url.searchParams.get('from') ?? undefined, url.searchParams.get('to') ?? undefined); return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="eldorado-orders.csv"', 'cache-control': 'no-store' } }); } catch (error) { return errorResponse(error); }
}
