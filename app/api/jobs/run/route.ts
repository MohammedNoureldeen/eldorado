import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/config';
import { errorResponse } from '@/lib/errors';
import { runBackgroundJobs } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

async function run(request: NextRequest) {
  if (!env.healthcheckToken || request.headers.get('authorization') !== `Bearer ${env.healthcheckToken}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await runBackgroundJobs());
}

export async function POST(request: NextRequest) {
  try { return await run(request); } catch (error) { return errorResponse(error); }
}

export async function GET(request: NextRequest) {
  try { return await run(request); } catch (error) { return errorResponse(error); }
}
