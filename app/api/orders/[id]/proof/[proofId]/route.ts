import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors';
import { requireSession } from '@/lib/auth/session';
import { getProofUrl } from '@/lib/orders/service';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string; proofId: string }> }) {
  const params = await context.params;
  try { const session = await requireSession(request); return NextResponse.json({ url: await getProofUrl(session.user, params.id, params.proofId) }, { headers: { 'cache-control': 'no-store' } }); } catch (error) { return errorResponse(error); }
}

