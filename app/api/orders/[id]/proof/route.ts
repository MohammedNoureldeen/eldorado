import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors';
import { assertCsrf, requireSession } from '@/lib/auth/session';
import { addProof } from '@/lib/orders/service';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession(request); assertCsrf(request, session);
    const form = await request.formData();
    const file = form.get('file');
    const type = String(form.get('type') ?? 'DELIVERY_SCREENSHOT') as 'DELIVERY_SCREENSHOT' | 'RECEIPT' | 'OTHER';
    if (!(file instanceof File)) return Response.json({ error: 'Proof file is required' }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    return NextResponse.json(await addProof(session.user, params.id, { type: file.type, size: file.size, bytes }, type), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
