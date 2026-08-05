import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { env } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (env.healthcheckToken && request.headers.get('authorization') !== `Bearer ${env.healthcheckToken}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try { await db.$queryRaw`SELECT 1`; return NextResponse.json({ ok: true, database: 'up', time: new Date().toISOString() }); } catch { return NextResponse.json({ ok: false, database: 'down' }, { status: 503 }); }
}
