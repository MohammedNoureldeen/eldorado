import { ShiftEventType, ShiftStatus, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { AppError, assert } from '@/lib/errors';
import { splitShiftMinutes } from '@/lib/domain';
import { AuthUser, assertRole } from '@/lib/auth/rbac';
import { enqueueTelegram } from '@/lib/notifications/telegram';

type Actor = Pick<AuthUser, 'id' | 'organizationId' | 'role'>;

async function openShift(actor: Actor) {
  return db.shift.findFirst({ where: { organizationId: actor.organizationId, workerId: actor.id, status: ShiftStatus.OPEN }, include: { events: { orderBy: { occurredAt: 'asc' } } } });
}

async function appendEvent(actor: Actor, type: ShiftEventType, reason?: string, targetWorkerId = actor.id, shiftId?: string, recordedType = type): Promise<{ shiftId: string }> {
  const shift = shiftId ? await db.shift.findFirst({ where: { id: shiftId, organizationId: actor.organizationId }, include: { events: { orderBy: { occurredAt: 'asc' } } } }) : await openShift({ ...actor, id: targetWorkerId });
  assert(shift, 404, 'Open shift not found', 'SHIFT_NOT_FOUND');
  if (actor.role === UserRole.WORKER && shift.workerId !== actor.id) throw new AppError(403, 'Workers can only update their own shift');
  const now = new Date();
  await db.shiftEvent.create({ data: { shiftId: shift.id, workerId: shift.workerId, type: recordedType, occurredAt: now, reason: reason?.trim().slice(0, 500), metadataJson: { source: actor.role === UserRole.OWNER_ADMIN ? 'admin' : 'worker', correctionType: type === ShiftEventType.ADMIN_CORRECTION ? recordedType : undefined } } });
  const events = [...shift.events, { type: recordedType, occurredAt: now }];
  const totals = splitShiftMinutes(events);
  await db.shift.update({ where: { id: shift.id }, data: { actualStart: type === ShiftEventType.CLOCK_IN ? now : undefined, actualEnd: type === ShiftEventType.CLOCK_OUT ? now : undefined, status: type === ShiftEventType.CLOCK_OUT ? ShiftStatus.CLOSED : ShiftStatus.OPEN, connectedMinutes: totals.connectedMinutes, breakMinutes: totals.breakMinutes, unexplainedGapMinutes: totals.unexplainedGapMinutes } });
  await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action: `SHIFT_${type}`, entityType: 'SHIFT', entityId: shift.id, result: 'SUCCESS', metadataJson: { workerId: shift.workerId, reason } } });
  if (type === ShiftEventType.DISCONNECT || type === ShiftEventType.CLOCK_OUT) await enqueueTelegram({ organizationId: actor.organizationId, type: type === ShiftEventType.DISCONNECT ? 'WORKER_DISCONNECTED' : 'WORKER_CLOCK_OUT', message: `Worker shift event: ${type}.`, dedupeKey: `shift:${shift.id}:${type}:${now.toISOString()}`, critical: false }).catch(() => undefined);
  return { shiftId: shift.id };
}

export async function clockIn(actor: Actor): Promise<{ shiftId: string }> {
  assert(actor.role === UserRole.WORKER, 403, 'Only workers clock in');
  const existing = await openShift(actor);
  if (existing) return { shiftId: existing.id };
  const shift = await db.shift.create({ data: { organizationId: actor.organizationId, workerId: actor.id, actualStart: new Date(), status: ShiftStatus.OPEN, approvalState: 'DRAFT', events: { create: { workerId: actor.id, type: ShiftEventType.CLOCK_IN } } } });
  await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action: 'SHIFT_CLOCK_IN', entityType: 'SHIFT', entityId: shift.id, result: 'SUCCESS' } });
  await enqueueTelegram({ organizationId: actor.organizationId, type: 'WORKER_CLOCK_IN', message: `Worker clocked in at ${new Date().toISOString()}.`, dedupeKey: `shift:${shift.id}:clock-in`, critical: false }).catch(() => undefined);
  return { shiftId: shift.id };
}

export const startBreak = (actor: Actor) => appendEvent(actor, ShiftEventType.BREAK_START);
export const endBreak = (actor: Actor) => appendEvent(actor, ShiftEventType.BREAK_END);
export const heartbeat = (actor: Actor) => appendEvent(actor, ShiftEventType.HEARTBEAT);
export const disconnect = (actor: Actor) => appendEvent(actor, ShiftEventType.DISCONNECT);

export async function clockOut(actor: Actor): Promise<{ shiftId: string }> {
  return appendEvent(actor, ShiftEventType.CLOCK_OUT);
}

export async function correctShift(actor: Actor, shiftId: string, type: ShiftEventType, reason: string): Promise<{ shiftId: string }> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  assert(type === ShiftEventType.CLOCK_IN || type === ShiftEventType.CLOCK_OUT || type === ShiftEventType.BREAK_START || type === ShiftEventType.BREAK_END || type === ShiftEventType.RECONNECT || type === ShiftEventType.DISCONNECT, 400, 'Unsupported correction event');
  assert(reason.trim().length >= 3, 400, 'Correction reason is required');
  return appendEvent(actor, ShiftEventType.ADMIN_CORRECTION, reason, actor.id, shiftId, type);
}

export async function currentShift(actor: Actor): Promise<unknown> { return openShift(actor); }
