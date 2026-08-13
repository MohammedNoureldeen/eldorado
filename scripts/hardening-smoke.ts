import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { FulfillmentSource, OrderStatus, Platform, ProofType, UserRole, UserStatus } from '@prisma/client';
import { db } from '../src/lib/db';
import { env } from '../src/lib/config';
import { hashPassword } from '../src/lib/auth/password';
import { addCredentials, changeOrderStatus, confirmFutOrder, createOrder, deleteExpiredCredentials, getOrder, listOrders, prepareFutOrder, syncFutOrder } from '../src/lib/orders/service';
import { decryptCredentialSet } from '../src/lib/crypto/secrets';
import { rotateCredentialEncryption } from '../src/lib/security/credential-maintenance';
import { checkSharedRateLimit } from '../src/lib/security/rate-limit';
import { summaryReport } from '../src/lib/reports';
import type { FutProvider } from '../src/lib/integrations/fut';
import { emergencyStopAutomation, getAutomationPolicy, updateAutomationPolicy } from '../src/lib/automation';

const keyV1 = Buffer.alloc(32, 5).toString('base64');
const keyV2 = Buffer.alloc(32, 22).toString('base64');
env.credentialKeys = JSON.stringify({ v1: keyV1, v2: keyV2 });
env.credentialActiveKeyVersion = 'v1';

async function main() {
  const organization = await db.organization.findFirstOrThrow();
  const admin = await db.user.findFirstOrThrow({ where: { organizationId: organization.id, role: UserRole.OWNER_ADMIN, status: UserStatus.ACTIVE } });
  const worker = await db.user.findFirstOrThrow({ where: { organizationId: organization.id, role: UserRole.WORKER, status: UserStatus.ACTIVE } });
  const secondWorker = await db.user.create({ data: { organizationId: organization.id, email: `hardening-worker-${Date.now()}@example.invalid`, name: 'Hardening Worker Two', role: UserRole.WORKER, status: UserStatus.ACTIVE, passwordHash: await hashPassword('Hardening-Test-Password-123!'), passwordChangedAt: new Date(), workerProfile: { create: { organizationId: organization.id, employmentStart: new Date() } } } });
  const adminActor = { id: admin.id, organizationId: organization.id, role: UserRole.OWNER_ADMIN, status: UserStatus.ACTIVE, name: admin.name, email: admin.email } as const;
  const workerActor = { id: worker.id, organizationId: organization.id, role: UserRole.WORKER, status: UserStatus.ACTIVE, name: worker.name, email: worker.email } as const;
  const secondWorkerActor = { id: secondWorker.id, organizationId: organization.id, role: UserRole.WORKER, status: UserStatus.ACTIVE, name: secondWorker.name, email: secondWorker.email } as const;

  const incomplete = await createOrder(workerActor, { marketplaceReference: `hardening-incomplete-${Date.now()}`, customerName: 'Hardening Incomplete Customer', platform: Platform.PC, coinQuantity: 200_000, grossSaleMinor: 10_000, fulfillmentSource: FulfillmentSource.PUBLIC_SUPPLIER });
  await assert.rejects(() => changeOrderStatus(workerActor, incomplete.id, OrderStatus.READY_FOR_REVIEW, incomplete.version, 'Should remain draft'), /active customer credentials/i);

  const created = await createOrder(workerActor, { marketplaceReference: `hardening-confirm-${Date.now()}`, customerName: 'Hardening Concurrency Customer', platform: Platform.PC, coinQuantity: 200_000, grossSaleMinor: 10_000, fulfillmentSource: FulfillmentSource.PUBLIC_SUPPLIER });
  await addCredentials(workerActor, created.id, { email: 'hardening-customer@example.invalid', password: 'sanitized-password', backupCodes: ['sanitized-code'] });
  await changeOrderStatus(workerActor, created.id, OrderStatus.WAITING_FOR_DETAILS, created.version, 'Hardening test details');
  await changeOrderStatus(workerActor, created.id, OrderStatus.READY_FOR_REVIEW, created.version + 1, 'Hardening test review');
  await changeOrderStatus(workerActor, created.id, OrderStatus.APPROVED, created.version + 2, 'Hardening test approval');
  let providerCreates = 0;
  const provider: FutProvider = {
    getPrice: async () => ({ costMinor: 4_000, currency: 'USD', supplierId: 'hardening-supplier', isPublicSupplier: true }),
    createOrder: async () => { providerCreates += 1; await new Promise((resolve) => setTimeout(resolve, 25)); return { providerOrderId: `hardening-provider-${created.id}`, status: 'entered', actualCostMinor: 4_000, currency: 'USD' }; },
    getStatus: async () => ({ providerOrderId: `hardening-provider-${created.id}`, status: 'finished', accountCheck: 'finished', economyState: 'finished', actualCostMinor: 4_000, currency: 'USD' }),
    cancelOrder: async () => ({ status: 'stopped' }),
    getBalance: async () => ({ balanceMinor: 100_000, currency: 'USD' })
  };
  const prepared = await prepareFutOrder(workerActor, created.id, provider);
  const confirmationResults = await Promise.allSettled(Array.from({ length: 8 }, () => confirmFutOrder(workerActor, created.id, prepared.version, provider)));
  assert.equal(providerCreates, 1, 'concurrent confirmations must create exactly one provider order');
  assert.equal(confirmationResults.filter((result) => result.status === 'fulfilled').length, 1);

  assert.equal((await listOrders(secondWorkerActor)).some((order) => (order as { id: string }).id === created.id), false);
  await assert.rejects(() => getOrder(secondWorkerActor, created.id), (error: unknown) => error instanceof Error && /cannot access/i.test(error.message));
  await assert.rejects(() => summaryReport(secondWorkerActor), (error: unknown) => error instanceof Error && /role/i.test(error.message));

  await syncFutOrder(adminActor, created.id, provider);
  await db.proofFile.create({ data: { orderId: created.id, objectKey: `hardening/${created.id}`, type: ProofType.DELIVERY_SCREENSHOT, checksum: 'b'.repeat(64), mimeType: 'image/png', sizeBytes: 8, uploadedById: worker.id, retentionDate: new Date(Date.now() + 86_400_000) } });
  const beforeComplete = await db.order.findUniqueOrThrow({ where: { id: created.id } });
  await changeOrderStatus(adminActor, created.id, OrderStatus.COMPLETED, beforeComplete.version, 'Hardening proof verified');
  const completed = await db.order.findUniqueOrThrow({ where: { id: created.id }, include: { credentials: true } });
  assert(completed.closedAt && completed.credentials);
  assert.equal(completed.credentials.deletionDueAt.getTime(), completed.closedAt.getTime() + 7 * 86_400_000);

  const rotationOrder = await createOrder(workerActor, { marketplaceReference: `hardening-rotation-${Date.now()}`, customerName: 'Hardening Rotation Customer', platform: Platform.XBOX, coinQuantity: 200_000, grossSaleMinor: 8_000, fulfillmentSource: FulfillmentSource.OWNED_SENDERS });
  await addCredentials(workerActor, rotationOrder.id, { email: 'rotation@example.invalid', password: 'rotation-password', backupCodes: ['rotation-code'] });
  env.credentialActiveKeyVersion = 'v2';
  const rotation = await rotateCredentialEncryption(adminActor);
  assert(rotation.rotated >= 1);
  const rotated = await db.customerCredential.findUniqueOrThrow({ where: { orderId: rotationOrder.id } });
  assert.equal(rotated.keyVersion, 'v2');
  assert.deepEqual(decryptCredentialSet(rotated), { email: 'rotation@example.invalid', password: 'rotation-password', backupCodes: ['rotation-code'] });

  await db.customerCredential.update({ where: { orderId: rotationOrder.id }, data: { deletionDueAt: new Date(Date.now() - 1000) } });
  const deletedCount = await deleteExpiredCredentials();
  assert(deletedCount >= 1);
  const deleted = await db.customerCredential.findUniqueOrThrow({ where: { orderId: rotationOrder.id } });
  assert.equal(deleted.emailCiphertext, null);
  assert.equal(deleted.passwordCiphertext, null);
  assert.equal(deleted.backupCodesCiphertext, null);
  assert(deleted.deletedAt);

  const limiterKey = `hardening:${randomUUID()}`;
  const limiterResults = await Promise.all(Array.from({ length: 20 }, () => checkSharedRateLimit(limiterKey, 10, 60_000)));
  assert.equal(limiterResults.filter((result) => result.allowed).length, 10);
  const limiterHash = createHash('sha256').update(limiterKey).digest('hex');
  const bucket = await db.rateLimitBucket.findUniqueOrThrow({ where: { keyHash: limiterHash } });
  assert.equal(bucket.count, 20);

  const automaticPolicy = { ...(await getAutomationPolicy(adminActor)), mode: 'AUTOMATIC' as const, killSwitch: false, maxGrossSaleMinor: 10_000, maxCoinQuantity: 200_000, maxQuoteAgeSeconds: 60, minMarginBps: 1_000, minBalanceAfterMinor: 10_000, maxConsecutiveFailures: 2, maxRiskLevel: 1, allowedPlatforms: [Platform.PC], allowedSources: [FulfillmentSource.PUBLIC_SUPPLIER] };
  await assert.rejects(() => updateAutomationPolicy(adminActor, automaticPolicy), /acknowledgement/i);
  await updateAutomationPolicy(adminActor, automaticPolicy, 'ENABLE CONTROLLED AUTOMATION');
  assert.deepEqual(await getAutomationPolicy(adminActor), automaticPolicy);
  await emergencyStopAutomation(adminActor);
  const stoppedPolicy = await getAutomationPolicy(adminActor);
  assert.equal(stoppedPolicy.mode, 'MANUAL');
  assert.equal(stoppedPolicy.killSwitch, true);

  const audit = await db.auditEvent.create({ data: { organizationId: organization.id, actorId: admin.id, action: 'HARDENING_APPEND_ONLY_TEST', entityType: 'TEST', result: 'SUCCESS' } });
  await assert.rejects(() => db.$executeRaw`UPDATE "AuditEvent" SET "result" = 'MUTATED' WHERE "id" = CAST(${audit.id} AS uuid)`, /immutable history/i);
  const unchanged = await db.auditEvent.findUniqueOrThrow({ where: { id: audit.id } });
  assert.equal(unchanged.result, 'SUCCESS');

  console.log(JSON.stringify({ incompleteOrderGuard: true, concurrentConfirmations: confirmationResults.length, providerCreates, workerIsolation: true, terminalRetentionDays: 7, rotatedCredentials: rotation.rotated, deletedCredentials: deletedCount, sharedRateLimitAllowed: 10, automationEmergencyStop: true, appendOnlyAudit: true }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
