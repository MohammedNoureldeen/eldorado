import test from 'node:test';
import assert from 'node:assert/strict';
import { FulfillmentSource } from '@prisma/client';
import { env } from '@/lib/config';
import { FutProviderError, HttpFutProvider, interpretFutStatus } from '@/lib/integrations/fut';
import { validateProof } from '@/lib/storage';

function configureFut(): void {
  env.futBaseUrl = 'https://fut.test';
  env.futApiUser = 'server@example.com';
  env.futApiKeyMd5 = '0123456789abcdef0123456789abcdef';
  env.futMaxRetries = 0;
  env.futOwnedCostPer100kMinor = 250;
}

test('FUT public quote uses the documented body auth and selects the cheapest eligible supplier', async () => {
  configureFut();
  const originalFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = (async (input, init) => {
    request = new Request(input, init);
    return new Response(JSON.stringify({ suppliers: [
      { supplierID: 7, stockPC: 400, pricePC: '4.20', stockConsole: 0, priceConsole: 0 },
      { supplierID: 8, stockPC: 900, pricePC: '3.50', stockConsole: 0, priceConsole: 0 }
    ], balance: '120.00' }), { status: 200 });
  }) as typeof fetch;
  try {
    const quote = await new HttpFutProvider().getPrice({ platform: 'PC', coinQuantity: 250_000, fulfillmentSource: FulfillmentSource.PUBLIC_SUPPLIER });
    assert.equal(quote.costMinor, 875);
    assert.equal(quote.supplierId, '8');
    assert.equal(new URL(request?.url ?? '').pathname, '/buyConditionAPI');
    const body = JSON.parse(await request!.text()) as Record<string, unknown>;
    assert.equal(body.apiUser, 'server@example.com');
    assert.equal(body.apiKey, '0123456789abcdef0123456789abcdef');
    assert.equal(body.amount, 250);
    assert.equal(request?.headers.get('authorization'), null);
  } finally { globalThis.fetch = originalFetch; }
});

test('FUT owned-sender quote checks available capacity and applies configured internal cost', async () => {
  configureFut();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ maxOrderConsole: 300, maxOrderPC: 100 }), { status: 200 })) as typeof fetch;
  try {
    const quote = await new HttpFutProvider().getPrice({ platform: 'PS', coinQuantity: 200_000, fulfillmentSource: FulfillmentSource.OWNED_SENDERS });
    assert.equal(quote.capacityK, 300);
    assert.equal(quote.costMinor, 500);
    await assert.rejects(() => new HttpFutProvider().getPrice({ platform: 'PC', coinQuantity: 200_000, fulfillmentSource: FulfillmentSource.OWNED_SENDERS }), (error: unknown) => error instanceof FutProviderError && error.code === 'NO_STOCK');
  } finally { globalThis.fetch = originalFetch; }
});

test('FUT submission sends credentials only in the provider body and is never automatically retried', async () => {
  configureFut();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    throw new TypeError('network lost after dispatch');
  }) as typeof fetch;
  try {
    await assert.rejects(() => new HttpFutProvider().createOrder({
      platform: 'XB', coinQuantity: 200_000, externalOrderId: 'fc2f70a1-6d4c-47df-881a-2e005d64fb45', expectedCostMinor: 700, currency: 'USD', fulfillmentSource: FulfillmentSource.PUBLIC_SUPPLIER,
      credentials: { customerName: 'Customer', email: 'customer@example.com', password: 'password123', backupCodes: ['backup1', 'backup2'] }, supplierId: '42', isPublicSupplier: true
    }), (error: unknown) => error instanceof FutProviderError && error.ambiguous && error.retryable);
    assert.equal(calls, 1);
    assert.equal(requestBody.user, 'customer@example.com');
    assert.equal(requestBody.pass, 'password123');
    assert.equal(requestBody.ba, 'backup1');
    assert.equal(requestBody.externalOrderID, 'fc2f70a1-6d4c-47df-881a-2e005d64fb45');
  } finally { globalThis.fetch = originalFetch; }
});

test('FUT recovery queries by external ID and strips returned backup codes from metadata', async () => {
  configureFut();
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ orderID: 'provider-123', status: 'partlyDelivered', accountCheck: 'finished', economyState: 'transfersInProgress', amountOrdered: 250, amount: 150, toPay: '8.75', ba1: 'must-not-be-stored' }), { status: 200 });
  }) as typeof fetch;
  try {
    const status = await new HttpFutProvider().getStatus({ externalOrderId: 'internal-uuid' });
    assert.equal(requestBody.externalID, 1);
    assert.equal(status.providerOrderId, 'provider-123');
    assert.equal(status.actualCostMinor, 875);
    assert.deepEqual(status.rawMetadata, { status: 200, bodyKeys: ['orderID', 'status', 'accountCheck', 'economyState', 'amountOrdered', 'amount', 'toPay', 'ba1'] });
  } finally { globalThis.fetch = originalFetch; }
});

test('FUT correction uses the documented endpoint and can resume by external ID', async () => {
  configureFut();
  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ updatedPassword: true, wasContinued: true }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await new HttpFutProvider().correctCredentials({ externalOrderId: 'internal-uuid', platform: 'PLAYSTATION', resume: true, credentials: { customerName: 'Customer', email: 'new@example.com', password: 'new-password', backupCodes: ['new-code'] } });
    assert.equal(new URL(requestUrl).pathname, '/correctCredentialsAPI');
    assert.equal(requestBody.externalOrderID, 1);
    assert.equal(requestBody.continue, 1);
    assert.equal(requestBody.platform, 'PS');
    assert.equal(result.status, 'resumed');
  } finally { globalThis.fetch = originalFetch; }
});

test('FUT status mapping follows documented action states and escalates unknown codes', () => {
  assert.equal(interpretFutStatus({ status: 'finished', accountCheck: 'finished', economyState: 'finished' }).orderStatus, 'COMPLETED');
  assert.equal(interpretFutStatus({ status: 'interrupted', accountCheck: 'wrongBA' }).orderStatus, 'CUSTOMER_ACTION_REQUIRED');
  assert.match(interpretFutStatus({ status: 'interrupted', economyState: 'belowMinTransfer' }).instruction ?? '', /remaining amount/i);
  const unknown = interpretFutStatus({ status: 'newProviderState' });
  assert.equal(unknown.orderStatus, 'CUSTOMER_ACTION_REQUIRED');
  assert.equal(unknown.unknownCode, 'newProviderState');
});

test('FUT adapter rejects malformed responses and maps HTTP failures', async () => {
  configureFut();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{not-json', { status: 200 })) as typeof fetch;
  try { await assert.rejects(() => new HttpFutProvider().getBalance(), (error: unknown) => error instanceof FutProviderError && error.code === 'MALFORMED_RESPONSE'); } finally { globalThis.fetch = originalFetch; }
  globalThis.fetch = (async () => new Response('{}', { status: 402 })) as typeof fetch;
  try { await assert.rejects(() => new HttpFutProvider().getBalance(), (error: unknown) => error instanceof FutProviderError && error.code === 'INSUFFICIENT_BALANCE'); } finally { globalThis.fetch = originalFetch; }
});

test('proof validation checks type, magic bytes, size, and checksum', () => {
  const file = validateProof({ type: 'image/png', size: 8, bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
  assert.equal(file.checksum.length, 64);
  assert.throws(() => validateProof({ type: 'image/png', size: 4, bytes: Buffer.from('text') }), /content/);
  assert.throws(() => validateProof({ type: 'application/x-sh', size: 1, bytes: Buffer.from('#!') }), /Only/);
});
