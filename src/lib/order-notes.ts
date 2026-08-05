import { db } from '@/lib/db';
import { assert } from '@/lib/errors';
import { AuthUser, canAccessOrder } from '@/lib/auth/rbac';

type Actor = Pick<AuthUser, 'id' | 'organizationId' | 'role'>;

export async function addOrderNote(actor: Actor, orderId: string, body: string): Promise<string> {
  assert(body.trim().length >= 1 && body.length <= 5000, 400, 'Note must be between 1 and 5000 characters');
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId }, select: { id: true, assignedWorkerId: true, status: true } });
  assert(order, 404, 'Order not found');
  assert(canAccessOrder(actor as AuthUser, order.assignedWorkerId, order.status), 403, 'You cannot access this order');
  const note = await db.orderNote.create({ data: { orderId, authorId: actor.id, body: body.trim() } });
  await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId, action: 'ORDER_NOTE_ADDED', entityType: 'ORDER_NOTE', entityId: note.id, result: 'SUCCESS' } });
  return note.id;
}
