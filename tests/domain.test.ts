import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from '@/lib/config';
import { encryptCredentialSet, decryptCredentialSet } from '@/lib/crypto/secrets';
import { assertTransition, calculatePayroll, calculateProfit, closureDeletionDate, redactSensitive, splitShiftMinutes } from '@/lib/domain';
import { convertMinorToEgp } from '@/lib/ledger';
import { generateBase32Secret, generateTotp, verifyTotp } from '@/lib/auth/totp';
import { InMemoryOrderWorkflow } from '@/lib/testing/workflow';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { canAccessOrder } from '@/lib/auth/rbac';
import { checkRateLimit } from '@/lib/security/rate-limit';

env.credentialKeys = JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') });
env.credentialActiveKeyVersion = 'v1';

test('credential fields are independently encrypted and decryptable', () => {
  const encrypted = encryptCredentialSet({ email: 'customer@example.com', password: 'secret-password', backupCodes: ['one'] });
  assert.notEqual(encrypted.emailCiphertext, encrypted.passwordCiphertext);
  assert(!encrypted.emailCiphertext.includes('customer@example.com'));
  assert.deepEqual(decryptCredentialSet(encrypted), { email: 'customer@example.com', password: 'secret-password', backupCodes: ['one'] });
});

test('order transitions reject unsafe jumps', () => {
  assertTransition('DRAFT', 'WAITING_FOR_DETAILS');
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

test('fixed-point currency conversion and profit avoid floating point arithmetic', () => {
  assert.equal(convertMinorToEgp(100, '50.50000000'), 5050);
  assert.equal(calculateProfit([{ type: 'REVENUE', amountMinor: 1000, currency: 'EGP' }, { type: 'FUT_COST', amountMinor: 250, currency: 'EGP' }]), 750);
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

test('vertical workflow requires approval, confirmation, proof, and reconciles profit', async () => {
  const provider = {
    getPrice: async () => ({ costMinor: 400_000, currency: 'EGP' }),
    createOrder: async () => ({ providerOrderId: 'provider-1', status: 'SUBMITTED', actualCostMinor: 420_000, currency: 'EGP' }),
    getStatus: async () => ({ providerOrderId: 'provider-1', status: 'COMPLETED', actualCostMinor: 420_000, currency: 'EGP' }),
    cancelOrder: async () => ({ status: 'CANCELLED' }),
    getBalance: async () => ({ balanceMinor: 1_000_000, currency: 'EGP' })
  };
  const workflow = new InMemoryOrderWorkflow();
  workflow.saveCredentials('customer@example.com', 'password');
  workflow.move('WAITING_FOR_DETAILS'); workflow.move('READY_FOR_REVIEW');
  await workflow.prepare(provider); workflow.move('APPROVED');
  await workflow.confirm(provider);
  assert.throws(() => workflow.complete(), /actual cost and proof/);
  workflow.uploadProof(); workflow.complete();
  assert.equal(workflow.profit(), 580_000);
  assert.equal(workflow.reveal().email, 'customer@example.com');
  assert(workflow.audit.includes('ORDER_RECONCILED'));
});
