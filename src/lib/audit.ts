import { db } from '@/lib/db';
import { redactSensitive } from '@/lib/domain';

export type AuditInput = {
  organizationId: string;
  actorId?: string;
  sessionId?: string;
  orderId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  ipAddress?: string;
  result: 'SUCCESS' | 'FAILURE' | 'DENIED';
  metadata?: unknown;
};

export async function recordAudit(input: AuditInput, client: typeof db = db): Promise<void> {
  await client.auditEvent.create({ data: {
    organizationId: input.organizationId,
    actorId: input.actorId,
    sessionId: input.sessionId,
    orderId: input.orderId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    ipAddress: input.ipAddress,
    result: input.result,
    metadataJson: redactSensitive(input.metadata) as object | undefined
  } });
}
