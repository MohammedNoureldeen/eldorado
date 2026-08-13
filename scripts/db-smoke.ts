import assert from 'node:assert/strict';
import { FulfillmentSource, OrderStatus, Platform, ProofType, UserRole, UserStatus } from '@prisma/client';
import { db } from '../src/lib/db';
import { env } from '../src/lib/config';
import { createOrder, addCredentials, changeOrderStatus, prepareFutOrder, confirmFutOrder, syncFutOrder } from '../src/lib/orders/service';
import { reconcileOrder } from '../src/lib/ledger';
import type { FutProvider } from '../src/lib/integrations/fut';

env.credentialKeys = JSON.stringify({ v1: Buffer.alloc(32, 5).toString('base64') });
env.credentialActiveKeyVersion = 'v1';

async function main() {
  const organization = await db.organization.findFirstOrThrow();
  const admin = await db.user.findFirstOrThrow({ where: { organizationId: organization.id, role: UserRole.OWNER_ADMIN, status: UserStatus.ACTIVE } });
  const worker = await db.user.findFirstOrThrow({ where: { organizationId: organization.id, role: UserRole.WORKER, status: UserStatus.ACTIVE } });
  const adminActor = { id: admin.id, organizationId: organization.id, role: UserRole.OWNER_ADMIN, status: UserStatus.ACTIVE, name: admin.name, email: admin.email } as const;
  const workerActor = { id: worker.id, organizationId: organization.id, role: UserRole.WORKER, status: UserStatus.ACTIVE, name: worker.name, email: worker.email } as const;
  const marketplaceReference = `db-smoke-${Date.now()}`;
  const created = await createOrder(workerActor, { marketplaceReference, customerName: 'Database Smoke Customer', platform: Platform.PC, coinQuantity: 200_000, grossSaleMinor: 10_000, fulfillmentSource: FulfillmentSource.PUBLIC_SUPPLIER });
  await addCredentials(workerActor, created.id, { email: 'db-smoke@example.invalid', password: 'not-logged', backupCodes: ['sanitized-code'] });
  await changeOrderStatus(workerActor, created.id, OrderStatus.WAITING_FOR_DETAILS, created.version, 'Details received');
  await changeOrderStatus(workerActor, created.id, OrderStatus.READY_FOR_REVIEW, created.version + 1, 'Ready for review');
  await changeOrderStatus(workerActor, created.id, OrderStatus.APPROVED, created.version + 2, 'Worker approval');
  const provider: FutProvider = { getPrice: async () => ({ costMinor: 4_000, currency: 'USD' }), createOrder: async () => ({ providerOrderId: 'db-smoke-provider', status: 'entered', actualCostMinor: 4_200, currency: 'USD' }), getStatus: async () => ({ providerOrderId: 'db-smoke-provider', status: 'finished', actualCostMinor: 4_200, currency: 'USD' }), cancelOrder: async () => ({ status: 'stopped' }), getBalance: async () => ({ balanceMinor: 100_000, currency: 'USD' }) };
  const prepared = await prepareFutOrder(workerActor, created.id, provider);
  await confirmFutOrder(workerActor, created.id, prepared.version, provider);
  await syncFutOrder(adminActor, created.id, provider);
  await db.proofFile.create({ data: { orderId: created.id, objectKey: `db-smoke/${created.id}`, type: ProofType.DELIVERY_SCREENSHOT, checksum: 'a'.repeat(64), mimeType: 'image/png', sizeBytes: 8, uploadedById: worker.id, retentionDate: new Date(Date.now() + 86_400_000) } });
  const afterSync = await db.order.findUniqueOrThrow({ where: { id: created.id } });
  await changeOrderStatus(adminActor, created.id, OrderStatus.COMPLETED, afterSync.version, 'Proof verified');
  await reconcileOrder(adminActor, created.id, { USD: '1' });
  const result = await db.order.findUniqueOrThrow({ where: { id: created.id }, include: { credentials: true, statusHistory: true, financialEntries: true } });
  assert.equal(result.status, OrderStatus.COMPLETED);
  assert.equal(result.reconciledAt !== null, true);
  assert.equal(result.credentials?.emailCiphertext?.includes('db-smoke@example.invalid'), false);
  assert.equal(result.statusHistory.length >= 6, true);
  assert.equal(result.financialEntries.length >= 2, true);
  console.log(`Database smoke passed for ${created.id}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
