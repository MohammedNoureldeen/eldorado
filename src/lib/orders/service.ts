import { randomUUID } from 'node:crypto';
import { FulfillmentSource, OrderStatus, Platform, Prisma, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { env } from '@/lib/config';
import { AppError, assert } from '@/lib/errors';
import { AuthUser, canAccessOrder, assertRole } from '@/lib/auth/rbac';
import { assertTransition, basisPointAmount, closureDeletionDate, createCustomerFingerprint, formatOrderReference, minimumCoinQuantity, normalizeCustomerName, normalizeMarketplaceReference, redactSensitive } from '@/lib/domain';
import { encryptCredentialSet, decryptCredentialSet } from '@/lib/crypto/secrets';
import { FutProvider, FutProviderError, interpretFutStatus, newCorrelationId } from '@/lib/integrations/fut';
import { putPrivateProof, scanProof, signedProofUrl, validateProof } from '@/lib/storage';
import { getSetting } from '@/lib/settings';
import { enqueueTelegram } from '@/lib/notifications/telegram';

const terminalStatuses = new Set<OrderStatus>([OrderStatus.COMPLETED, OrderStatus.FAILED, OrderStatus.CANCELLED, OrderStatus.REFUNDED]);

type Actor = Pick<AuthUser, 'id' | 'organizationId' | 'role'>;

function isAdmin(actor: Actor): boolean { return actor.role === UserRole.OWNER_ADMIN; }

function assertOrderAccess(actor: Actor, order: { assignedWorkerId: string | null; status: OrderStatus }, write = false): void {
  if (!canAccessOrder(actor as AuthUser, order.assignedWorkerId, order.status)) throw new AppError(403, 'You cannot access this order', 'ORDER_FORBIDDEN');
  if (write && terminalStatuses.has(order.status) && !isAdmin(actor)) throw new AppError(403, 'Closed orders are read-only for workers', 'ORDER_CLOSED');
}

type CreateOrderInput = { marketplaceReference?: string; customerName: string; platform: Platform; coinQuantity: number; grossSaleMinor: number; fulfillmentSource: FulfillmentSource; deadline?: string; assignedWorkerId?: string };

export async function createOrder(actor: Actor, input: CreateOrderInput): Promise<{ id: string; orderReference: string; version: number; duplicateWarning: { id: string; orderReference: string; createdAt: Date } | null }> {
  assertOrderAccessForCreate(actor, input.assignedWorkerId);
  const marketplaceReference = normalizeMarketplaceReference(input.marketplaceReference);
  const customerName = normalizeCustomerName(input.customerName);
  assert(!marketplaceReference || marketplaceReference.length <= 120, 400, 'Marketplace reference must be 120 characters or fewer');
  assert(customerName.length >= 2 && customerName.length <= 160, 400, 'Customer name is required');
  assert(Number.isInteger(input.coinQuantity) && input.coinQuantity >= minimumCoinQuantity && input.coinQuantity % 1_000 === 0, 400, `Coin quantity must be at least ${minimumCoinQuantity} and use 1,000-coin increments`);
  assert(Number.isInteger(input.grossSaleMinor) && input.grossSaleMinor > 0, 400, 'Sale amount must be positive minor units');
  assert(Object.values(FulfillmentSource).includes(input.fulfillmentSource), 400, 'A valid fulfillment source is required');
  const assignedWorkerId = input.assignedWorkerId ?? (actor.role === UserRole.WORKER ? actor.id : undefined);
  if (assignedWorkerId) {
    const worker = await db.user.findFirst({ where: { id: assignedWorkerId, organizationId: actor.organizationId, role: UserRole.WORKER, status: 'ACTIVE' } });
    assert(worker, 400, 'Assigned user must be an active worker');
  }
  const customerFingerprint = createCustomerFingerprint(actor.organizationId, customerName);
  const duplicateWarning = await db.order.findFirst({
    where: { organizationId: actor.organizationId, customerFingerprint, platform: input.platform, coinQuantity: input.coinQuantity, grossSaleMinor: input.grossSaleMinor, createdAt: { gte: new Date(Date.now() - 30 * 60_000) } },
    select: { id: true, orderReference: true, createdAt: true },
    orderBy: { createdAt: 'desc' }
  });
  try {
    const created = await db.$transaction(async (tx) => {
      const now = new Date();
      const year = now.getUTCFullYear();
      const counter = await tx.orderReferenceCounter.upsert({ where: { organizationId_year: { organizationId: actor.organizationId, year } }, create: { organizationId: actor.organizationId, year, nextValue: 2 }, update: { nextValue: { increment: 1 } } });
      const orderReference = formatOrderReference(year, counter.nextValue - 1);
      const feePolicy = await tx.marketplaceFeePolicy.findFirst({ where: { organizationId: actor.organizationId, active: true, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: { effectiveFrom: 'desc' } });
      const feeBps = feePolicy?.feeBps ?? 500;
      const order = await tx.order.create({ data: { organizationId: actor.organizationId, orderReference, marketplaceReference, eldoradoOrderId: marketplaceReference, customerName, customerFingerprint, platform: input.platform, coinQuantity: input.coinQuantity, fulfillmentSource: input.fulfillmentSource, grossSaleMinor: input.grossSaleMinor, saleCurrency: 'USD', marketplaceFeeMinor: basisPointAmount(input.grossSaleMinor, feeBps), marketplaceFeeRateBps: feeBps, marketplaceFeePolicyId: feePolicy?.id, deadline: input.deadline ? new Date(input.deadline) : undefined, assignedWorkerId, createdById: actor.id } });
      await tx.orderStatusHistory.create({ data: { orderId: order.id, next: OrderStatus.DRAFT, actorId: actor.id, source: 'manual', reason: 'Order created' } });
      await tx.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId: order.id, action: 'ORDER_CREATED', entityType: 'ORDER', entityId: order.id, result: 'SUCCESS', metadataJson: { orderReference, marketplaceReference, platform: order.platform, fulfillmentSource: order.fulfillmentSource, feeBps } } });
      return { id: order.id, orderReference, version: order.version, duplicateWarning };
    });
    if (!assignedWorkerId) await enqueueTelegram({ organizationId: actor.organizationId, type: 'ORDER_UNASSIGNED', message: `New unassigned order ${created.orderReference} requires assignment.`, dedupeKey: `order-unassigned:${created.id}`, critical: false }).catch(() => undefined);
    return created;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(409, 'Marketplace reference already exists', 'DUPLICATE_MARKETPLACE_REFERENCE');
    throw error;
  }
}

function assertOrderAccessForCreate(actor: Actor, assignedWorkerId?: string): void {
  if (actor.role === UserRole.WORKER && assignedWorkerId && assignedWorkerId !== actor.id) throw new AppError(403, 'Workers can only create orders assigned to themselves', 'ORDER_ASSIGNMENT_FORBIDDEN');
}

export async function listOrders(actor: Actor): Promise<unknown[]> {
  const orders = await db.order.findMany({ where: { organizationId: actor.organizationId, ...(actor.role === UserRole.WORKER ? { assignedWorkerId: actor.id } : {}) }, include: { assignedWorker: { select: { id: true, name: true, email: true } }, futOrder: { select: { status: true, submissionState: true, fulfillmentSource: true, estimatedCostMinor: true, estimatedCostCurrency: true, actualCostMinor: true, actualCostCurrency: true, quoteFetchedAt: true, quoteExpiresAt: true } }, credentials: { select: { deletedAt: true, deletionDueAt: true } }, _count: { select: { proofFiles: true, notes: true } } }, orderBy: [{ deadline: 'asc' }, { createdAt: 'desc' }] });
  if (isAdmin(actor) || await getSetting(actor.organizationId, 'workerQuoteVisibility', true)) return orders;
  return orders.map((order) => ({ ...order, futOrder: order.futOrder ? { ...order.futOrder, estimatedCostMinor: null, estimatedCostCurrency: null, actualCostMinor: null, actualCostCurrency: null } : null }));
}

export async function getOrder(actor: Actor, orderId: string): Promise<unknown> {
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId }, include: { assignedWorker: { select: { id: true, name: true, email: true } }, futOrder: true, credentials: { select: { deletedAt: true, deletionDueAt: true, keyVersion: true } }, statusHistory: { orderBy: { createdAt: 'asc' } }, credentialAccesses: { orderBy: { createdAt: 'asc' } }, financialEntries: { orderBy: { createdAt: 'asc' } }, proofFiles: { orderBy: { createdAt: 'asc' } }, notes: { orderBy: { createdAt: 'asc' } } } });
  assert(order, 404, 'Order not found', 'ORDER_NOT_FOUND');
  assertOrderAccess(actor, order, false);
  if (!isAdmin(actor)) {
    const { credentialAccesses: _credentialAccesses, financialEntries: _financialEntries, ...operationalOrder } = order;
    const quoteVisible = await getSetting(actor.organizationId, 'workerQuoteVisibility', true);
    return { ...operationalOrder, futOrder: operationalOrder.futOrder && !quoteVisible ? { ...operationalOrder.futOrder, estimatedCostMinor: null, estimatedCostCurrency: null, actualCostMinor: null, actualCostCurrency: null } : operationalOrder.futOrder };
  }
  return order;
}

export async function updateOrder(actor: Actor, orderId: string, version: number, input: { marketplaceReference?: string | null; customerName?: string; platform?: Platform; coinQuantity?: number; grossSaleMinor?: number; fulfillmentSource?: FulfillmentSource; deadline?: string | null; assignedWorkerId?: string | null }): Promise<void> {
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId } });
  assert(order, 404, 'Order not found', 'ORDER_NOT_FOUND');
  assertOrderAccess(actor, order, true);
  if (order.reconciledAt && !isAdmin(actor)) throw new AppError(403, 'Reconciled orders cannot be edited', 'ORDER_RECONCILED');
  if (input.coinQuantity !== undefined) assert(Number.isInteger(input.coinQuantity) && input.coinQuantity >= minimumCoinQuantity && input.coinQuantity % 1_000 === 0, 400, `Coin quantity must be at least ${minimumCoinQuantity} and use 1,000-coin increments`);
  if (input.grossSaleMinor !== undefined) assert(Number.isInteger(input.grossSaleMinor) && input.grossSaleMinor > 0, 400, 'Sale amount must be positive');
  if (input.fulfillmentSource !== undefined) assert(Object.values(FulfillmentSource).includes(input.fulfillmentSource), 400, 'A valid fulfillment source is required');
  if (input.assignedWorkerId !== undefined && !isAdmin(actor)) throw new AppError(403, 'Only administrators can assign or reassign orders', 'ORDER_ASSIGNMENT_FORBIDDEN');
  if (input.assignedWorkerId) {
    const worker = await db.user.findFirst({ where: { id: input.assignedWorkerId, organizationId: actor.organizationId, role: UserRole.WORKER, status: 'ACTIVE' } });
    assert(worker, 400, 'Assigned user must be an active worker');
  }
  const customerName = input.customerName === undefined ? undefined : normalizeCustomerName(input.customerName);
  if (customerName !== undefined) assert(customerName.length >= 2 && customerName.length <= 160, 400, 'Customer name is required');
  const marketplaceReference = input.marketplaceReference === undefined ? undefined : normalizeMarketplaceReference(input.marketplaceReference);
  if (marketplaceReference) assert(marketplaceReference.length <= 120, 400, 'Marketplace reference must be 120 characters or fewer');
  const grossSaleMinor = input.grossSaleMinor;
  const result = await db.order.updateMany({ where: { id: order.id, version }, data: { marketplaceReference, eldoradoOrderId: marketplaceReference, customerName, customerFingerprint: customerName === undefined ? undefined : createCustomerFingerprint(actor.organizationId, customerName), platform: input.platform, coinQuantity: input.coinQuantity, grossSaleMinor, marketplaceFeeMinor: grossSaleMinor === undefined ? undefined : basisPointAmount(grossSaleMinor, order.marketplaceFeeRateBps), fulfillmentSource: input.fulfillmentSource, deadline: input.deadline === null ? null : input.deadline ? new Date(input.deadline) : undefined, assignedWorkerId: input.assignedWorkerId, version: { increment: 1 } } });
  if (!result.count) throw new AppError(409, 'Order changed; reload before editing', 'ORDER_VERSION_CONFLICT');
  await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId: order.id, action: 'ORDER_UPDATED', entityType: 'ORDER', entityId: order.id, result: 'SUCCESS', metadataJson: redactSensitive(input) as object } });
}

export async function addCredentials(actor: Actor, orderId: string, input: { email: string; password: string; backupCodes?: string[] }): Promise<void> {
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId } });
  assert(order, 404, 'Order not found', 'ORDER_NOT_FOUND');
  assertOrderAccess(actor, order, true);
  assert(input.email.includes('@') && input.email.length <= 320, 400, 'A valid customer email is required');
  assert(input.password.length >= 1 && input.password.length <= 1000, 400, 'Customer password is required');
  assert(input.backupCodes?.some((code) => code.trim().length > 0), 400, 'At least one backup code is required');
  const encrypted = encryptCredentialSet(input);
  const deletionDueAt = order.closedAt ? closureDeletionDate(order.closedAt) : new Date(Date.now() + 3650 * 86_400_000);
  await db.customerCredential.upsert({ where: { orderId }, create: { orderId, ...encrypted, deletionDueAt }, update: { ...encrypted, deletionDueAt, deletedAt: null, deletionFailure: null } });
  await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId, action: 'CREDENTIALS_SAVED', entityType: 'CUSTOMER_CREDENTIAL', entityId: orderId, result: 'SUCCESS', metadataJson: { fields: ['email', 'password', ...(input.backupCodes?.length ? ['backupCodes'] : [])] } } });
}

export async function deleteCredentialsNow(actor: Actor, orderId: string): Promise<void> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId }, include: { credentials: true } });
  assert(order, 404, 'Order not found', 'ORDER_NOT_FOUND');
  if (!order.credentials || order.credentials.deletedAt) return;
  await db.customerCredential.update({ where: { orderId }, data: { emailCiphertext: null, passwordCiphertext: null, backupCodesCiphertext: null, deletedAt: new Date(), deletionDueAt: new Date(), deletionFailure: null } });
  await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId, action: 'CREDENTIALS_DELETED', entityType: 'CUSTOMER_CREDENTIAL', entityId: order.credentials.id, result: 'SUCCESS', metadataJson: { reason: 'admin_immediate_deletion' } } });
}

export async function revealCredentials(actor: Actor, orderId: string, reason: string, ipAddress?: string): Promise<{ email: string; password: string; backupCodes: string[] }> {
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId }, include: { credentials: true } });
  assert(order, 404, 'Order not found', 'ORDER_NOT_FOUND');
  assert(reason.trim().length >= 3 && reason.length <= 200, 400, 'Reveal reason is required');
  const allowed = canAccessOrder(actor as AuthUser, order.assignedWorkerId, order.status) && (isAdmin(actor) || !terminalStatuses.has(order.status));
  if (!allowed) {
    await db.credentialAccessEvent.create({ data: { orderId, actorId: actor.id, reason: reason.trim(), success: false, ipAddress } });
    throw new AppError(403, 'Credential reveal is not allowed for this order', 'CREDENTIAL_REVEAL_FORBIDDEN');
  }
  try {
    assert(order.credentials, 404, 'Credentials not found', 'CREDENTIALS_NOT_FOUND');
    const result = decryptCredentialSet(order.credentials);
    await db.credentialAccessEvent.create({ data: { orderId, actorId: actor.id, reason: reason.trim(), success: true, ipAddress } });
    await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId, action: 'CREDENTIALS_REVEALED', entityType: 'CUSTOMER_CREDENTIAL', entityId: orderId, ipAddress, result: 'SUCCESS', metadataJson: { reason: reason.trim() } } });
    return result;
  } catch (error) {
    await db.credentialAccessEvent.create({ data: { orderId, actorId: actor.id, reason: reason.trim(), success: false, ipAddress } });
    throw error;
  }
}

async function transitionWithHistory(actor: Actor, order: { id: string; organizationId: string; status: OrderStatus; version: number; closedAt: Date | null }, next: OrderStatus, reason: string, source: string): Promise<void> {
  assertTransition(order.status, next);
  const closedAt = terminalStatuses.has(next) ? (order.closedAt ?? new Date()) : null;
  const result = await db.order.updateMany({ where: { id: order.id, version: order.version }, data: { status: next, version: { increment: 1 }, closedAt } });
  if (!result.count) throw new AppError(409, 'Order changed; reload before updating status', 'ORDER_VERSION_CONFLICT');
  await db.orderStatusHistory.create({ data: { orderId: order.id, previous: order.status, next, actorId: actor.id, reason, source } });
  if (closedAt) await db.customerCredential.updateMany({ where: { orderId: order.id, deletedAt: null }, data: { deletionDueAt: closureDeletionDate(closedAt) } });
  else await db.customerCredential.updateMany({ where: { orderId: order.id, deletedAt: null }, data: { deletionDueAt: new Date(Date.now() + 3650 * 86_400_000) } });
  await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId: order.id, action: 'ORDER_STATUS_CHANGED', entityType: 'ORDER', entityId: order.id, result: 'SUCCESS', metadataJson: { previous: order.status, next, reason, source } } });
}

export async function changeOrderStatus(actor: Actor, orderId: string, next: OrderStatus, version: number, reason: string, source = 'manual'): Promise<void> {
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId }, include: { credentials: true, futOrder: true, proofFiles: true } });
  assert(order, 404, 'Order not found', 'ORDER_NOT_FOUND');
  assertOrderAccess(actor, order, true);
  assert(order.version === version, 409, 'Order changed; reload before updating status', 'ORDER_VERSION_CONFLICT');
  if (next === OrderStatus.APPROVED || next === OrderStatus.SUBMITTED_TO_FUT) {
    assert(order.assignedWorkerId, 400, 'Assign a worker before submission');
    assert(order.coinQuantity > 0 && order.grossSaleMinor > 0, 400, 'Platform, quantity, and sale amount are required');
    assert(order.credentials?.emailCiphertext && order.credentials.passwordCiphertext && !order.credentials.deletedAt, 400, 'Active customer credentials are required');
  }
  if (next === OrderStatus.COMPLETED) {
    assert(order.futOrder?.actualCostMinor != null, 400, 'Actual FUT cost is required before completion');
    assert(order.proofFiles.length > 0, 400, 'Delivery proof is required before completion');
  }
  if (next === OrderStatus.REFUNDED) assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  await transitionWithHistory(actor, order, next, reason.trim().slice(0, 500), source);
}

export async function prepareFutOrder(actor: Actor, orderId: string, provider: FutProvider): Promise<{ id: string; estimatedCostMinor: number; currency: string; version: number }> {
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId }, include: { credentials: true, futOrder: true } });
  assert(order, 404, 'Order not found', 'ORDER_NOT_FOUND');
  assertOrderAccess(actor, order, true);
  assert(([OrderStatus.READY_FOR_REVIEW, OrderStatus.APPROVED] as OrderStatus[]).includes(order.status), 409, 'Order is not ready for FUT preparation', 'ORDER_NOT_READY');
  assert(order.assignedWorkerId && order.credentials?.emailCiphertext && order.credentials.passwordCiphertext && !order.credentials.deletedAt, 400, 'Assigned worker and active credentials are required');
  if (order.futOrder?.providerOrderId) return { id: order.futOrder.id, estimatedCostMinor: order.futOrder.estimatedCostMinor ?? 0, currency: order.futOrder.estimatedCostCurrency ?? order.saleCurrency, version: order.version };
  const price = await provider.getPrice({ platform: order.platform, coinQuantity: order.coinQuantity, fulfillmentSource: order.fulfillmentSource });
  assert(Number.isSafeInteger(price.costMinor) && price.costMinor >= 0, 502, 'FUT returned an invalid price', 'FUT_MALFORMED_RESPONSE');
  const id = order.futOrder?.id ?? randomUUID();
  const correlationId = order.futOrder?.correlationId ?? newCorrelationId();
  const fut = order.futOrder
    ? await db.futOrder.update({ where: { id }, data: { status: 'PREPARED', submissionState: 'PREPARED', fulfillmentSource: order.fulfillmentSource, supplierId: price.supplierId, isPublicSupplier: price.isPublicSupplier, senderGroup: price.senderGroup, estimatedCostMinor: price.costMinor, estimatedCostCurrency: price.currency, quoteFetchedAt: new Date(), quoteExpiresAt: price.expiresAt ? new Date(price.expiresAt) : null, requestSnapshotJson: { platform: order.platform, coinQuantity: order.coinQuantity, fulfillmentSource: order.fulfillmentSource, expectedVersion: order.version, capacityK: price.capacityK } } })
    : await db.futOrder.create({ data: { orderId, externalOrderId: order.id, idempotencyKey: order.id, correlationId, status: 'PREPARED', submissionState: 'PREPARED', fulfillmentSource: order.fulfillmentSource, supplierId: price.supplierId, isPublicSupplier: price.isPublicSupplier, senderGroup: price.senderGroup, estimatedCostMinor: price.costMinor, estimatedCostCurrency: price.currency, quoteFetchedAt: new Date(), quoteExpiresAt: price.expiresAt ? new Date(price.expiresAt) : null, requestSnapshotJson: { platform: order.platform, coinQuantity: order.coinQuantity, fulfillmentSource: order.fulfillmentSource, expectedVersion: order.version, capacityK: price.capacityK } } });
  await db.futApiEvent.create({ data: { orderId, futOrderId: fut.id, direction: 'OUTBOUND', endpoint: order.fulfillmentSource === FulfillmentSource.PUBLIC_SUPPLIER ? '/buyConditionAPI' : '/availableStockAPI', correlationId, responseMetadataJson: { costMinor: price.costMinor, currency: price.currency, expiresAt: price.expiresAt, capacityK: price.capacityK, supplierSelected: Boolean(price.supplierId), senderGroup: price.senderGroup } } });
  await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId, action: 'FUT_ORDER_PREPARED', entityType: 'FUT_ORDER', entityId: fut.id, result: 'SUCCESS', metadataJson: { costMinor: price.costMinor, currency: price.currency, correlationId } } });
  return { id: fut.id, estimatedCostMinor: price.costMinor, currency: price.currency, version: order.version };
}

export async function confirmFutOrder(actor: Actor, orderId: string, expectedVersion: number, provider: FutProvider, options: { source?: 'human' | 'automation' } = {}): Promise<void> {
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId }, include: { futOrder: true, credentials: true } });
  assert(order, 404, 'Order not found', 'ORDER_NOT_FOUND');
  assertOrderAccess(actor, order, true);
  assert(order.status === OrderStatus.APPROVED, 409, 'Order must be approved before FUT confirmation', 'ORDER_NOT_APPROVED');
  assert(order.version === expectedVersion, 409, 'Order changed; reconfirm the current review', 'ORDER_VERSION_CONFLICT');
  assert(order.futOrder, 400, 'Prepare the FUT order before confirming');
  const futOrder = order.futOrder;
  assert(futOrder.submissionState === 'PREPARED', 409, futOrder.submissionState === 'UNKNOWN' ? 'FUT submission result is unknown; recover it before any retry' : 'FUT order is not ready for confirmation', 'FUT_SUBMISSION_NOT_PREPARED');
  assert(order.credentials && !order.credentials.deletedAt, 400, 'Active customer credentials are required');
  if (!isAdmin(actor)) {
    const approvalLimit = await getSetting(actor.organizationId, 'futApprovalLimitMinor', Number.MAX_SAFE_INTEGER);
    if (order.grossSaleMinor >= approvalLimit) throw new AppError(403, 'This order requires administrator FUT approval', 'HIGH_VALUE_APPROVAL_REQUIRED');
  }
  const currentPrice = await provider.getPrice({ platform: order.platform, coinQuantity: order.coinQuantity, fulfillmentSource: order.fulfillmentSource });
  const toleranceBps = await getSetting(actor.organizationId, 'futPriceToleranceBps', env.futPriceToleranceBps);
  const expectedCost = futOrder.estimatedCostMinor ?? 0;
  const priceChanged = currentPrice.currency !== futOrder.estimatedCostCurrency || (expectedCost > 0 && Math.abs(currentPrice.costMinor - expectedCost) * 10_000 > expectedCost * toleranceBps);
  if (priceChanged) {
    await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId, action: 'FUT_PRICE_CHANGED', entityType: 'FUT_ORDER', entityId: futOrder.id, result: 'FAILURE', metadataJson: { previousCostMinor: expectedCost, currentCostMinor: currentPrice.costMinor, previousCurrency: futOrder.estimatedCostCurrency, currentCurrency: currentPrice.currency, toleranceBps } } });
    await enqueueTelegram({ organizationId: actor.organizationId, type: 'FUT_PRICE_CHANGED', orderId, message: `FUT price changed for order ${order.orderReference}; worker confirmation is required again.`, dedupeKey: `fut-price:${order.id}:${currentPrice.costMinor}:${currentPrice.currency}`, critical: true }).catch(() => undefined);
    throw new AppError(409, 'FUT price changed beyond the configured tolerance; prepare and reconfirm', 'FUT_PRICE_CHANGED');
  }
  const reserved = await db.order.updateMany({ where: { id: order.id, status: OrderStatus.APPROVED, version: expectedVersion }, data: { version: { increment: 1 } } });
  if (!reserved.count) throw new AppError(409, 'This confirmation was already handled or the order changed', 'DUPLICATE_FUT_CONFIRMATION');
  await db.futOrder.update({ where: { id: futOrder.id }, data: { submissionState: 'CONFIRMING' } });
  try {
    // Decrypt only at the provider boundary. The plaintext is never written to logs, events, or request snapshots.
    const credentials = decryptCredentialSet(order.credentials);
    const result = await provider.createOrder({ platform: order.platform, coinQuantity: order.coinQuantity, externalOrderId: futOrder.externalOrderId, expectedCostMinor: futOrder.estimatedCostMinor ?? 0, currency: futOrder.estimatedCostCurrency ?? order.saleCurrency, fulfillmentSource: order.fulfillmentSource, credentials: { customerName: order.customerName, ...credentials }, supplierId: futOrder.supplierId ?? undefined, isPublicSupplier: futOrder.isPublicSupplier ?? undefined, senderGroup: futOrder.senderGroup ?? undefined });
    const mapped = interpretFutStatus({ status: result.status }).orderStatus;
    await db.$transaction(async (tx) => {
      await tx.futOrder.update({ where: { id: futOrder.id }, data: { providerOrderId: result.providerOrderId, status: mapped === 'COMPLETED' ? 'COMPLETED' : mapped, submissionState: mapped === 'COMPLETED' ? 'COMPLETED' : 'SUBMITTED', actualCostMinor: result.actualCostMinor, actualCostCurrency: result.currency, submittedAt: new Date(), lastSyncedAt: new Date() } });
      await tx.futApiEvent.create({ data: { orderId, futOrderId: futOrder.id, direction: 'OUTBOUND', endpoint: order.fulfillmentSource === FulfillmentSource.PUBLIC_SUPPLIER ? '/buyCoinsAPI' : '/orderAPI', correlationId: futOrder.correlationId, responseMetadataJson: redactSensitive(result.rawMetadata) as object } });
      await tx.order.update({ where: { id: order.id }, data: { status: mapped === 'COMPLETED' ? OrderStatus.PROCESSING : mapped, version: { increment: 1 } } });
      await tx.orderStatusHistory.create({ data: { orderId, previous: OrderStatus.APPROVED, next: mapped === 'COMPLETED' ? OrderStatus.PROCESSING : mapped, actorId: actor.id, source: options.source === 'automation' ? 'automation' : 'fut', reason: options.source === 'automation' ? 'Controlled automation policy approved FUT submission' : 'FUT confirmation accepted' } });
      await tx.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId, action: options.source === 'automation' ? 'FUT_ORDER_AUTOMATED' : 'FUT_ORDER_CONFIRMED', entityType: 'FUT_ORDER', entityId: futOrder.id, result: 'SUCCESS', metadataJson: { providerOrderId: result.providerOrderId, status: mapped, confirmationSource: options.source ?? 'human' } } });
    });
  } catch (error) {
    if (error instanceof FutProviderError && error.ambiguous) {
      await db.$transaction(async (tx) => {
        await tx.futOrder.update({ where: { id: futOrder.id }, data: { status: 'CUSTOMER_ACTION_REQUIRED', submissionState: 'UNKNOWN' } });
        await tx.futApiEvent.create({ data: { orderId, futOrderId: futOrder.id, direction: 'OUTBOUND', endpoint: order.fulfillmentSource === FulfillmentSource.PUBLIC_SUPPLIER ? '/buyCoinsAPI' : '/orderAPI', correlationId: futOrder.correlationId, responseMetadataJson: { errorCode: error.code, result: 'UNKNOWN', recoveryKey: 'externalOrderID' } } });
        await tx.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId, action: 'FUT_SUBMISSION_UNKNOWN', entityType: 'FUT_ORDER', entityId: futOrder.id, result: 'FAILURE', metadataJson: { correlationId: futOrder.correlationId, recovery: 'query_external_order_id_before_retry' } } });
      });
      await enqueueTelegram({ organizationId: actor.organizationId, type: 'FUT_FAILURE', orderId, message: `FUT submission result is unknown for order ${order.orderReference}. Recover by external order ID; do not submit again.`, dedupeKey: `fut-unknown:${order.id}:${futOrder.correlationId}`, critical: true }).catch(() => undefined);
      throw new AppError(502, 'FUT submission result is unknown. Use Sync to recover it; do not submit again.', 'FUT_SUBMISSION_UNKNOWN');
    }
    const closedAt = new Date();
    await db.$transaction(async (tx) => {
      await tx.futOrder.update({ where: { id: futOrder.id }, data: { status: 'FAILED', submissionState: 'FAILED' } });
      await tx.futApiEvent.create({ data: { orderId, futOrderId: futOrder.id, direction: 'OUTBOUND', endpoint: '/orders', correlationId: futOrder.correlationId, responseMetadataJson: { errorCode: error instanceof FutProviderError ? error.code : 'PROVIDER_ERROR' } } });
      await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.FAILED, closedAt, version: { increment: 1 } } });
      await tx.customerCredential.updateMany({ where: { orderId, deletedAt: null }, data: { deletionDueAt: closureDeletionDate(closedAt) } });
      await tx.orderStatusHistory.create({ data: { orderId, previous: OrderStatus.APPROVED, next: OrderStatus.FAILED, actorId: actor.id, source: 'fut', reason: 'FUT confirmation failed; manual recovery required' } });
      await tx.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId, action: 'FUT_ORDER_CONFIRMATION_FAILED', entityType: 'FUT_ORDER', entityId: futOrder.id, result: 'FAILURE', metadataJson: { error: error instanceof Error ? error.message : 'provider error' } } });
    });
    await enqueueTelegram({ organizationId: actor.organizationId, type: 'FUT_FAILURE', orderId, message: `FUT submission failed for order ${order.orderReference}; manual recovery is required.`, dedupeKey: `fut-failure:${order.id}:${order.version}`, critical: true }).catch(() => undefined);
    throw error;
  }
}

export async function syncFutOrder(actor: Actor, orderId: string, provider: FutProvider): Promise<void> {
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId }, include: { futOrder: true } });
  assert(order, 404, 'Order not found', 'ORDER_NOT_FOUND');
  assertOrderAccess(actor, order, true);
  assert(order.futOrder && (order.futOrder.providerOrderId || order.futOrder.submissionState === 'UNKNOWN'), 400, 'FUT provider order has not been submitted');
  const result = await provider.getStatus(order.futOrder.providerOrderId ? { providerOrderId: order.futOrder.providerOrderId } : { externalOrderId: order.futOrder.externalOrderId });
  const interpretation = interpretFutStatus(result);
  const mapped = interpretation.orderStatus;
  const nextOrderStatus = mapped === 'COMPLETED' ? OrderStatus.PROCESSING : mapped;
  const futOrder = order.futOrder;
  await db.$transaction(async (tx) => {
    await tx.futOrder.update({ where: { id: futOrder.id }, data: { providerOrderId: result.providerOrderId ?? undefined, status: mapped, submissionState: mapped === 'COMPLETED' ? 'COMPLETED' : mapped === 'FAILED' ? 'FAILED' : mapped === 'CANCELLED' ? 'CANCELLED' : 'SUBMITTED', actualCostMinor: result.actualCostMinor ?? undefined, actualCostCurrency: result.currency ?? undefined, completedAt: mapped === 'COMPLETED' ? new Date() : undefined, lastSyncedAt: new Date() } });
    await tx.futApiEvent.create({ data: { orderId, futOrderId: futOrder.id, direction: 'INBOUND', endpoint: '/orderStatusAPI', correlationId: futOrder.correlationId, responseMetadataJson: { ...(redactSensitive(result.rawMetadata) as object), status: result.status, accountCheck: result.accountCheck, economyState: result.economyState, deliveredK: result.deliveredK, orderedK: result.orderedK, unknownCode: interpretation.unknownCode } } });
    if (order.status !== nextOrderStatus && !terminalStatuses.has(order.status)) {
      const closedAt = terminalStatuses.has(nextOrderStatus) ? new Date() : undefined;
      await tx.order.update({ where: { id: order.id }, data: { status: nextOrderStatus, version: { increment: 1 }, closedAt } });
      if (closedAt) await tx.customerCredential.updateMany({ where: { orderId, deletedAt: null }, data: { deletionDueAt: closureDeletionDate(closedAt) } });
      await tx.orderStatusHistory.create({ data: { orderId, previous: order.status, next: nextOrderStatus, source: 'fut', reason: interpretation.instruction ?? `FUT status synchronized: ${result.status}` } });
    }
  });
}

export async function correctAndResumeFutOrder(actor: Actor, orderId: string, provider: FutProvider): Promise<void> {
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId }, include: { futOrder: true, credentials: true } });
  assert(order, 404, 'Order not found', 'ORDER_NOT_FOUND');
  assertOrderAccess(actor, order, true);
  assert(order.status === OrderStatus.CUSTOMER_ACTION_REQUIRED, 409, 'Order is not waiting for customer action', 'ORDER_NOT_WAITING_FOR_CUSTOMER');
  assert(order.futOrder && (order.futOrder.providerOrderId || order.futOrder.externalOrderId), 400, 'FUT order identifier is missing');
  assert(order.credentials && !order.credentials.deletedAt, 400, 'Save corrected customer credentials first');
  assert(provider.correctCredentials, 501, 'FUT credential correction is not supported by this provider');
  const credentials = decryptCredentialSet(order.credentials);
  try {
    const result = await provider.correctCredentials({ providerOrderId: order.futOrder.providerOrderId ?? undefined, externalOrderId: order.futOrder.providerOrderId ? undefined : order.futOrder.externalOrderId, credentials: { customerName: order.customerName, ...credentials }, platform: order.platform, resume: true });
    await db.$transaction(async (tx) => {
      await tx.futOrder.update({ where: { id: order.futOrder!.id }, data: { status: 'PROCESSING', submissionState: 'SUBMITTED', lastSyncedAt: new Date() } });
      await tx.futApiEvent.create({ data: { orderId, futOrderId: order.futOrder!.id, direction: 'OUTBOUND', endpoint: '/correctCredentialsAPI', correlationId: order.futOrder!.correlationId, responseMetadataJson: redactSensitive(result.rawMetadata) as object } });
      await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.PROCESSING, version: { increment: 1 } } });
      await tx.orderStatusHistory.create({ data: { orderId, previous: order.status, next: OrderStatus.PROCESSING, actorId: actor.id, source: 'fut', reason: 'Corrected credentials sent and FUT processing resumed' } });
      await tx.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId, action: 'FUT_CREDENTIALS_CORRECTED', entityType: 'FUT_ORDER', entityId: order.futOrder!.id, result: 'SUCCESS', metadataJson: { resumed: result.status === 'resumed' } } });
    });
  } catch (error) {
    await db.futApiEvent.create({ data: { orderId, futOrderId: order.futOrder.id, direction: 'OUTBOUND', endpoint: '/correctCredentialsAPI', correlationId: order.futOrder.correlationId, responseMetadataJson: { errorCode: error instanceof FutProviderError ? error.code : 'PROVIDER_ERROR', ambiguous: error instanceof FutProviderError ? error.ambiguous : false } } });
    throw error;
  }
}

export async function cancelFutOrder(actor: Actor, orderId: string, provider: FutProvider): Promise<void> {
  assertRole(actor as AuthUser, UserRole.OWNER_ADMIN);
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId }, include: { futOrder: true } });
  assert(order, 404, 'Order not found', 'ORDER_NOT_FOUND');
  assert(order.futOrder?.providerOrderId, 400, 'FUT order is not submitted');
  const result = await provider.cancelOrder(order.futOrder.providerOrderId);
  await db.futOrder.update({ where: { id: order.futOrder.id }, data: { status: 'CANCELLED', submissionState: 'CANCELLED', lastSyncedAt: new Date() } });
  await changeOrderStatus(actor, orderId, OrderStatus.CANCELLED, order.version, `FUT cancellation: ${result.status}`, 'fut');
}

export async function addProof(actor: Actor, orderId: string, file: { type: string; size: number; bytes: Buffer }, type: 'DELIVERY_SCREENSHOT' | 'RECEIPT' | 'OTHER'): Promise<{ id: string }> {
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId } });
  assert(order, 404, 'Order not found', 'ORDER_NOT_FOUND');
  assertOrderAccess(actor, order, true);
  assert(([OrderStatus.PROCESSING, OrderStatus.CUSTOMER_ACTION_REQUIRED, OrderStatus.COMPLETED] as OrderStatus[]).includes(order.status), 409, 'Proof can only be uploaded during fulfillment');
  const { checksum } = validateProof(file);
  await scanProof(file.bytes, file.type);
  const objectKey = `${actor.organizationId}/${orderId}/${randomUUID()}`;
  await putPrivateProof(objectKey, file.bytes, file.type, checksum);
  const proof = await db.proofFile.create({ data: { orderId, objectKey, type, checksum, mimeType: file.type, sizeBytes: file.size, uploadedById: actor.id, retentionDate: new Date(Date.now() + 365 * 86_400_000) } });
  await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, orderId, action: 'PROOF_UPLOADED', entityType: 'PROOF_FILE', entityId: proof.id, result: 'SUCCESS', metadataJson: { mimeType: file.type, sizeBytes: file.size, checksum } } });
  return { id: proof.id };
}

export async function getProofUrl(actor: Actor, orderId: string, proofId: string): Promise<string> {
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: actor.organizationId } });
  assert(order, 404, 'Order not found', 'ORDER_NOT_FOUND');
  assertOrderAccess(actor, order, false);
  const proof = await db.proofFile.findFirst({ where: { id: proofId, orderId } });
  assert(proof, 404, 'Proof file not found', 'PROOF_NOT_FOUND');
  return signedProofUrl(proof.objectKey);
}

export async function deleteExpiredCredentials(): Promise<number> {
  const rows = await db.customerCredential.findMany({ where: { deletionDueAt: { lte: new Date() }, deletedAt: null }, select: { id: true, orderId: true } });
  if (!rows.length) return 0;
  await db.customerCredential.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { emailCiphertext: null, passwordCiphertext: null, backupCodesCiphertext: null, deletedAt: new Date(), deletionFailure: null } });
  const remaining = await db.customerCredential.count({ where: { id: { in: rows.map((row) => row.id) }, OR: [{ emailCiphertext: { not: null } }, { passwordCiphertext: { not: null } }, { backupCodesCiphertext: { not: null } }] } });
  if (remaining) throw new Error(`Credential deletion verification failed for ${remaining} record(s)`);
  const orders = await db.order.findMany({ where: { id: { in: rows.map((row) => row.orderId) } }, select: { id: true, organizationId: true } });
  const organizationByOrder = new Map(orders.map((order) => [order.id, order.organizationId]));
  for (const row of rows) {
    const organizationId = organizationByOrder.get(row.orderId);
    if (organizationId) await db.auditEvent.create({ data: { organizationId, orderId: row.orderId, action: 'CREDENTIALS_DELETED', entityType: 'CUSTOMER_CREDENTIAL', entityId: row.id, result: 'SUCCESS', metadataJson: { reason: 'retention_deadline' } } });
  }
  return rows.length;
}
