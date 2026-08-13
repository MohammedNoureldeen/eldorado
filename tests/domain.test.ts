import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { env, validateProductionConfig } from '@/lib/config';
import { encryptCredentialSet, decryptCredentialSet } from '@/lib/crypto/secrets';
import { assertTransition, basisPointAmount, calculatePayroll, calculateProfit, closureDeletionDate, createCustomerFingerprint, formatOrderReference, normalizeMarketplaceReference, payrollOrderCounts, redactSensitive, splitShiftMinutes } from '@/lib/domain';
import { convertMinorToEgp } from '@/lib/ledger';
import { generateBase32Secret, generateTotp, verifyTotp } from '@/lib/auth/totp';
import { InMemoryOrderWorkflow } from '@/lib/testing/workflow';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { canAccessOrder } from '@/lib/auth/rbac';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { summarizeUsdLedger } from '@/lib/reports';
import { evaluateAutomation, defaultAutomationPolicy, type AutomationCandidate } from '@/lib/automation';
import { FulfillmentSource, OrderStatus, Platform } from '@prisma/client';

env.credentialKeys = JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') });
env.credentialActiveKeyVersion = 'v1';

test('credential fields are independently encrypted and decryptable', () => {
  const encrypted = encryptCredentialSet({ email: 'customer@example.com', password: 'secret-password', backupCodes: ['one'] });
  assert.notEqual(encrypted.emailCiphertext, encrypted.passwordCiphertext);
  assert(!encrypted.emailCiphertext.includes('customer@example.com'));
  assert.deepEqual(decryptCredentialSet(encrypted), { email: 'customer@example.com', password: 'secret-password', backupCodes: ['one'] });
});

test('production configuration rejects weak secrets and accepts a complete key set', () => {
  const credentialKeys = JSON.stringify({ v1: Buffer.alloc(32, 9).toString('base64') });
  const production = { databaseUrl: 'postgresql://db', sessionCookieSecret: 'x'.repeat(32), credentialKeys, credentialActiveKeyVersion: 'v1', healthcheckToken: 'y'.repeat(32), futProviderMode: 'http', futApiUser: 'owner@example.com', futApiKeyMd5: '0123456789abcdef0123456789abcdef', proofStorageMode: 's3', s3Endpoint: 'https://storage.invalid', s3Bucket: 'proofs', s3AccessKeyId: 'test', s3SecretAccessKey: 'test' };
  assert.throws(() => validateProductionConfig({ ...production, sessionCookieSecret: 'short' }), /SESSION_COOKIE_SECRET/);
  assert.throws(() => validateProductionConfig({ ...production, credentialActiveKeyVersion: 'v2' }), /ACTIVE_KEY_VERSION/);
  assert.throws(() => validateProductionConfig({ ...production, futProviderMode: 'fake' }), /FUT_PROVIDER_MODE/);
  assert.throws(() => validateProductionConfig({ ...production, futApiKeyMd5: 'plaintext' }), /FUT_API_KEY_MD5/);
  assert.throws(() => validateProductionConfig({ ...production, proofStorageMode: 'memory' }), /PROOF_STORAGE_MODE/);
  assert.doesNotThrow(() => validateProductionConfig(production));
});

test('MVP order references, USD fee math, and duplicate fingerprints are deterministic', () => {
  assert.equal(formatOrderReference(2026, 142), 'ELD-2026-000142');
  assert.equal(normalizeMarketplaceReference('  eldo  123 '), 'ELDO 123');
  assert.equal(normalizeMarketplaceReference('  '), null);
  assert.equal(basisPointAmount(12_345, 500), 617);
  assert.equal(createCustomerFingerprint('org-1', '  Alice  Smith '), createCustomerFingerprint('org-1', 'alice smith'));
  assert.notEqual(createCustomerFingerprint('org-1', 'alice smith'), createCustomerFingerprint('org-2', 'alice smith'));
});

test('sanitized fixtures represent public and owned fulfillment without credentials', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/mvp-orders.json', import.meta.url), 'utf8')) as Array<Record<string, unknown>>;
  assert.deepEqual(new Set(fixtures.map((fixture) => fixture.fulfillmentSource)), new Set(['PUBLIC_SUPPLIER', 'OWNED_SENDERS']));
  assert(fixtures.every((fixture) => fixture.saleCurrency === 'USD' && Number(fixture.coinQuantity) >= 200_000));
  assert(fixtures.every((fixture) => !Object.keys(fixture).some((key) => /password|backup|credential|api.?key/i.test(key))));
});

test('order transitions reject unsafe jumps', () => {
  assertTransition('DRAFT', 'WAITING_FOR_DETAILS');
  assertTransition('READY_FOR_REVIEW', 'COMPLETED');
  assertTransition('APPROVED', 'COMPLETED');
  assert.throws(() => assertTransition('DRAFT', 'COMPLETED'), /Invalid order transition/);
  assert.throws(() => assertTransition('REFUNDED', 'COMPLETED'), /Invalid order transition/);
});

test('salary boundaries follow the configured policy', () => {
  const policy = { tiers: [{ name: 'under-200', minCompleted: 0, baseSalaryMinor: 300_000 }, { name: '200-249', minCompleted: 200, baseSalaryMinor: 350_000 }, { name: '250+', minCompleted: 250, baseSalaryMinor: 500_000 }], bonusInterval: 10, bonusAmountMinor: 15_000 };
  assert.equal(calculatePayroll(199, policy).finalAmountMinor, 300_000);
  assert.equal(calculatePayroll(200, policy).finalAmountMinor, 350_000);
  assert.equal(calculatePayroll(249, policy).finalAmountMinor, 350_000);
  assert.equal(calculatePayroll(250, policy).finalAmountMinor, 500_000);
  assert.equal(calculatePayroll(259, policy).finalAmountMinor, 500_000);
  assert.equal(calculatePayroll(260, policy).finalAmountMinor, 515_000);
});

test('payroll handling rate uses assigned valid orders instead of mirroring completions', () => {
  assert.deepEqual(payrollOrderCounts(8, 10, 0), { completedCleanOrders: 8, assignedValidOrders: 10, handlingRateBps: 8000 });
  assert.deepEqual(payrollOrderCounts(8, 10, -1), { completedCleanOrders: 7, assignedValidOrders: 10, handlingRateBps: 7000 });
  assert.deepEqual(payrollOrderCounts(1, 0, 0), { completedCleanOrders: 1, assignedValidOrders: 1, handlingRateBps: 10000 });
});

test('fixed-point currency conversion and profit avoid floating point arithmetic', () => {
  assert.equal(convertMinorToEgp(100, '50.50000000'), 5050);
  assert.equal(calculateProfit([{ type: 'REVENUE', amountMinor: 1000, currency: 'EGP' }, { type: 'FUT_COST', amountMinor: 250, currency: 'EGP' }]), 750);
});

test('owner USD economy totals reconcile exactly from immutable ledger components', () => {
  const summary = summarizeUsdLedger([
    { type: 'REVENUE', amountMinor: 10_000, currency: 'USD' },
    { type: 'MARKETPLACE_FEE', amountMinor: 500, currency: 'USD' },
    { type: 'FUT_COST', amountMinor: 4_200, currency: 'USD' },
    { type: 'REFUND', amountMinor: 300, currency: 'USD' },
    { type: 'FX_FEE', amountMinor: 100, currency: 'USD' },
    { type: 'ADJUSTMENT', amountMinor: 50, currency: 'USD' },
    { type: 'REVENUE', amountMinor: 1_000, currency: 'EGP', egpAmountMinor: 1_000 }
  ]);
  assert.equal(summary.profitMinor, 4_950);
  assert.equal(summary.revenueMinor - summary.marketplaceFeeMinor - summary.futCostMinor - summary.refundMinor - summary.fxFeeMinor + summary.adjustmentMinor, summary.profitMinor);
  assert.equal(summary.nonUsdEntryCount, 1);
});

test('redaction removes credentials from nested logs', () => {
  assert.deepEqual(redactSensitive({ email: 'safe', password: 'do-not-log', child: { apiKey: 'nope' } }), { email: 'safe', password: '[REDACTED]', child: { apiKey: '[REDACTED]' } });
});

test('totp validates current code and rejects malformed or stale codes', () => {
  const secret = generateBase32Secret();
  const now = 1_700_000_000_000;
  const code = generateTotp(secret, now);
  assert.equal(verifyTotp(secret, code, now), true);
  assert.equal(verifyTotp(secret, '000000', now), false);
  assert.equal(verifyTotp(secret, code, now + 120_000), false);
});

test('shift totals disclose connected, break, and unexplained time', () => {
  const at = new Date('2026-01-01T08:00:00Z');
  const minutes = (value: number) => new Date(at.getTime() + value * 60_000);
  assert.deepEqual(splitShiftMinutes([{ type: 'CLOCK_IN', occurredAt: at }, { type: 'BREAK_START', occurredAt: minutes(60) }, { type: 'BREAK_END', occurredAt: minutes(75) }, { type: 'CLOCK_OUT', occurredAt: minutes(120) }]), { connectedMinutes: 105, breakMinutes: 15, unexplainedGapMinutes: 0 });
});

test('credential retention deadline is seven days after closure', () => {
  const closed = new Date('2026-01-01T00:00:00Z');
  assert.equal(closureDeletionDate(closed).toISOString(), '2026-01-08T00:00:00.000Z');
});

test('passwords use a one-way Argon2id hash and role access is scoped', async () => {
  const password = 'Strong-Test-Password-123!';
  const hash = await hashPassword(password);
  assert.notEqual(hash, password);
  assert.equal(await verifyPassword(hash, password), true);
  assert.equal(await verifyPassword(hash, 'wrong-password'), false);
  const worker = { id: 'worker-1', organizationId: 'org-1', role: 'WORKER' as const, status: 'ACTIVE' as const, name: 'Worker', email: 'worker@example.invalid' };
  assert.equal(canAccessOrder(worker, 'worker-1', 'PROCESSING'), true);
  assert.equal(canAccessOrder(worker, 'other-worker', 'PROCESSING'), false);
  assert.equal(canAccessOrder(worker, 'worker-1', 'REFUNDED'), false);
});

test('login rate limiter blocks only after the configured window count', () => {
  const key = `test-rate-${Date.now()}`;
  assert.equal(checkRateLimit(key, 2, 60_000).allowed, true);
  assert.equal(checkRateLimit(key, 2, 60_000).allowed, true);
  assert.equal(checkRateLimit(key, 2, 60_000).allowed, false);
});

test('automation is fail-closed by default and submits only inside every owner limit', () => {
  const now = new Date('2026-08-13T12:00:00Z');
  const candidate: AutomationCandidate = { status: OrderStatus.APPROVED, grossSaleMinor: 10_000, marketplaceFeeMinor: 500, coinQuantity: 200_000, platform: Platform.PLAYSTATION, fulfillmentSource: FulfillmentSource.PUBLIC_SUPPLIER, hasCredentials: true, submissionState: 'PREPARED', estimatedCostMinor: 4_000, quoteFetchedAt: new Date(now.getTime() - 5_000), quoteExpiresAt: new Date(now.getTime() + 30_000), riskLevel: '1', consecutiveFailures: 0, balanceMinor: 100_000 };
  const closed = evaluateAutomation(defaultAutomationPolicy, candidate, now);
  assert.equal(closed.eligible, false);
  assert(closed.reasons.includes('KILL_SWITCH_ACTIVE'));
  assert(closed.reasons.includes('MANUAL_MODE'));

  const policy = { ...defaultAutomationPolicy, mode: 'AUTOMATIC' as const, killSwitch: false, maxGrossSaleMinor: 10_000, maxCoinQuantity: 200_000, minMarginBps: 5_000, minBalanceAfterMinor: 50_000, maxConsecutiveFailures: 2, maxRiskLevel: 1, allowedPlatforms: [Platform.PLAYSTATION], allowedSources: [FulfillmentSource.PUBLIC_SUPPLIER] };
  assert.deepEqual(evaluateAutomation(policy, candidate, now), { eligible: true, reasons: [], marginBps: 5500 });

  const blockedCases: Array<[Partial<AutomationCandidate>, string]> = [
    [{ hasCredentials: false }, 'MISSING_CREDENTIALS'],
    [{ submissionState: 'UNKNOWN' }, 'UNKNOWN_SUBMISSION'],
    [{ quoteFetchedAt: new Date(now.getTime() - 61_000) }, 'STALE_QUOTE'],
    [{ balanceMinor: 53_999 }, 'LOW_BALANCE'],
    [{ riskLevel: '2' }, 'RISK_POLICY_VIOLATION'],
    [{ cooldownActive: true }, 'COOLDOWN_ACTIVE'],
    [{ consecutiveFailures: 2 }, 'REPEATED_FAILURES'],
    [{ estimatedCostMinor: 5_000 }, 'MARGIN_BELOW_LIMIT']
  ];
  for (const [change, reason] of blockedCases) assert(evaluateAutomation(policy, { ...candidate, ...change }, now).reasons.includes(reason), reason);
});

test('vertical workflow requires approval, confirmation, proof, and reconciles profit', async () => {
  const provider = {
    getPrice: async () => ({ costMinor: 4_000, currency: 'USD' }),
    createOrder: async () => ({ providerOrderId: 'provider-1', status: 'SUBMITTED', actualCostMinor: 4_200, currency: 'USD' }),
    getStatus: async () => ({ providerOrderId: 'provider-1', status: 'COMPLETED', actualCostMinor: 4_200, currency: 'USD' }),
    cancelOrder: async () => ({ status: 'CANCELLED' }),
    getBalance: async () => ({ balanceMinor: 100_000, currency: 'USD' })
  };
  const workflow = new InMemoryOrderWorkflow();
  workflow.saveCredentials('customer@example.com', 'password');
  workflow.move('WAITING_FOR_DETAILS'); workflow.move('READY_FOR_REVIEW');
  await workflow.prepare(provider); workflow.move('APPROVED');
  await workflow.confirm(provider);
  assert.throws(() => workflow.complete(), /actual cost and proof/);
  workflow.uploadProof(); workflow.complete();
  assert.equal(workflow.profit(), 5_800);
  assert.equal(workflow.reveal().email, 'customer@example.com');
  assert(workflow.audit.includes('ORDER_RECONCILED'));
});
