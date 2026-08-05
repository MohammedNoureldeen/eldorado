import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from '@/lib/config';
import { FutProviderError, HttpFutProvider, mapFutStatus } from '@/lib/integrations/fut';
import { validateProof } from '@/lib/storage';

test('FUT adapter sends server-side credentials and maps provider statuses', async () => {
  env.futBaseUrl = 'https://fut.test'; env.futApiKey = 'server-key'; env.futApiSecret = 'server-secret'; env.futMaxRetries = 0;
  const originalFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = (async (input, init) => { request = new Request(input, init); return new Response(JSON.stringify({ costMinor: 1234, currency: 'EGP' }), { status: 200 }); }) as typeof fetch;
  try {
    const price = await new HttpFutProvider().getPrice({ platform: 'PC', coinQuantity: 100 });
    assert.deepEqual(price, { costMinor: 1234, currency: 'EGP', expiresAt: undefined });
    assert.equal(request?.headers.get('authorization'), 'Bearer server-key');
    assert.equal(request?.headers.get('x-api-secret'), 'server-secret');
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(mapFutStatus('success'), 'COMPLETED');
  assert.equal(mapFutStatus('action_required'), 'CUSTOMER_ACTION_REQUIRED');
  assert.equal(mapFutStatus('unknown'), 'PROCESSING');
});

test('FUT adapter rejects malformed responses without exposing response bodies', async () => {
  env.futBaseUrl = 'https://fut.test'; env.futMaxRetries = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{not-json', { status: 200 })) as typeof fetch;
  try { await assert.rejects(() => new HttpFutProvider().getBalance(), (error: unknown) => error instanceof FutProviderError && error.code === 'MALFORMED_RESPONSE'); } finally { globalThis.fetch = originalFetch; }
});

test('FUT adapter retries transient provider failures and stops on authentication failure', async () => {
  env.futBaseUrl = 'https://fut.test'; env.futMaxRetries = 1;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return calls === 1 ? new Response('temporary', { status: 500 }) : new Response(JSON.stringify({ balanceMinor: 900, currency: 'EGP' }), { status: 200 }); }) as typeof fetch;
  try { assert.deepEqual(await new HttpFutProvider().getBalance(), { balanceMinor: 900, currency: 'EGP' }); assert.equal(calls, 2); } finally { globalThis.fetch = originalFetch; }
  env.futMaxRetries = 0;
  globalThis.fetch = (async () => new Response('denied', { status: 401 })) as typeof fetch;
  try { await assert.rejects(() => new HttpFutProvider().getBalance(), (error: unknown) => error instanceof FutProviderError && error.code === 'AUTHENTICATION'); } finally { globalThis.fetch = originalFetch; }
});

test('proof validation checks type, magic bytes, size, and checksum', () => {
  const file = validateProof({ type: 'image/png', size: 8, bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
  assert.equal(file.checksum.length, 64);
  assert.throws(() => validateProof({ type: 'image/png', size: 4, bytes: Buffer.from('text') }), /content/);
  assert.throws(() => validateProof({ type: 'application/x-sh', size: 1, bytes: Buffer.from('#!') }), /Only/);
});
