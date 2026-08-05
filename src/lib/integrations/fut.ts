import { randomUUID } from 'node:crypto';
import { env } from '@/lib/config';
import { redactSensitive } from '@/lib/domain';

export type FutPrice = { costMinor: number; currency: string; expiresAt?: string };
export type FutCreateInput = { platform: string; coinQuantity: number; idempotencyKey: string; expectedCostMinor: number; currency: string };
export type FutCreateResult = { providerOrderId: string; status: string; actualCostMinor?: number; currency?: string; rawMetadata?: unknown };
export type FutStatusResult = { providerOrderId: string; status: string; actualCostMinor?: number; currency?: string; rawMetadata?: unknown };
export type FutBalance = { balanceMinor: number; currency: string };

export interface FutProvider {
  getPrice(input: { platform: string; coinQuantity: number }): Promise<FutPrice>;
  createOrder(input: FutCreateInput): Promise<FutCreateResult>;
  getStatus(providerOrderId: string): Promise<FutStatusResult>;
  cancelOrder(providerOrderId: string): Promise<{ status: string }>;
  getBalance(): Promise<FutBalance>;
}

export class FutProviderError extends Error {
  constructor(message: string, public readonly code: 'TIMEOUT' | 'AUTHENTICATION' | 'RATE_LIMIT' | 'PRICE_CHANGED' | 'PROVIDER' | 'MALFORMED_RESPONSE', public readonly retryable: boolean, public readonly status?: number) {
    super(message);
  }
}

let circuitFailures = 0;
let circuitOpenedAt = 0;

function assertCircuit(): void {
  if (circuitFailures >= 5 && Date.now() - circuitOpenedAt < 30_000) throw new FutProviderError('FUT integration circuit is open', 'PROVIDER', false);
  if (circuitFailures >= 5) circuitFailures = 0;
}

function success(): void { circuitFailures = 0; }
function failure(): void { circuitFailures += 1; if (circuitFailures >= 5) circuitOpenedAt = Date.now(); }

async function request<T>(path: string, init: RequestInit, retries = env.futMaxRetries): Promise<{ data: T; status: number; metadata: unknown }> {
  if (!env.futBaseUrl) throw new FutProviderError('FUT base URL is not configured', 'PROVIDER', false);
  assertCircuit();
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.futTimeoutMs);
    try {
      const response = await fetch(new URL(path, env.futBaseUrl), { ...init, signal: controller.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${env.futApiKey}`, 'x-api-secret': env.futApiSecret, ...(init.headers ?? {}) } });
      const text = await response.text();
      let data: unknown = {};
      if (response.ok) {
        try { data = text ? JSON.parse(text) : {}; } catch { throw new FutProviderError('FUT returned malformed JSON', 'MALFORMED_RESPONSE', false, response.status); }
      }
      const metadata = redactSensitive({ status: response.status, bodyKeys: data && typeof data === 'object' ? Object.keys(data) : [] });
      if (response.ok) { success(); return { data: data as T, status: response.status, metadata }; }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (response.status === 401 || response.status === 403) throw new FutProviderError('FUT authentication failed', 'AUTHENTICATION', false, response.status);
      if (!retryable || attempt === retries) throw new FutProviderError('FUT request failed', response.status === 429 ? 'RATE_LIMIT' : 'PROVIDER', retryable, response.status);
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 4000)));
    } catch (error) {
      if (error instanceof FutProviderError && !error.retryable) { failure(); throw error; }
      if (error instanceof FutProviderError && attempt === retries) { failure(); throw error; }
      if (error instanceof Error && error.name === 'AbortError' && attempt === retries) { failure(); throw new FutProviderError('FUT request timed out', 'TIMEOUT', true); }
      if (attempt === retries) { failure(); throw new FutProviderError('FUT request failed', 'PROVIDER', true); }
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 4000)));
    } finally { clearTimeout(timeout); }
  }
  throw new FutProviderError('FUT request failed', 'PROVIDER', true);
}

function required<T extends Record<string, unknown>>(data: T, keys: string[]): T {
  if (keys.some((key) => data[key] === undefined || data[key] === null)) throw new FutProviderError('FUT returned an incomplete response', 'MALFORMED_RESPONSE', false);
  return data;
}

export class HttpFutProvider implements FutProvider {
  async getPrice(input: { platform: string; coinQuantity: number }): Promise<FutPrice> {
    const result = await request<Record<string, unknown>>('/price', { method: 'POST', body: JSON.stringify(input) });
    const data = required(result.data, ['costMinor', 'currency']);
    return { costMinor: Number(data.costMinor), currency: String(data.currency), expiresAt: data.expiresAt ? String(data.expiresAt) : undefined };
  }

  async createOrder(input: FutCreateInput): Promise<FutCreateResult> {
    const result = await request<Record<string, unknown>>('/orders', { method: 'POST', headers: { 'idempotency-key': input.idempotencyKey }, body: JSON.stringify(input) });
    const data = required(result.data, ['providerOrderId', 'status']);
    return { providerOrderId: String(data.providerOrderId), status: String(data.status), actualCostMinor: data.actualCostMinor == null ? undefined : Number(data.actualCostMinor), currency: data.currency ? String(data.currency) : undefined, rawMetadata: result.metadata };
  }

  async getStatus(providerOrderId: string): Promise<FutStatusResult> {
    const result = await request<Record<string, unknown>>(`/orders/${encodeURIComponent(providerOrderId)}`, { method: 'GET' });
    const data = required(result.data, ['providerOrderId', 'status']);
    return { providerOrderId: String(data.providerOrderId), status: String(data.status), actualCostMinor: data.actualCostMinor == null ? undefined : Number(data.actualCostMinor), currency: data.currency ? String(data.currency) : undefined, rawMetadata: result.metadata };
  }

  async cancelOrder(providerOrderId: string): Promise<{ status: string }> {
    const result = await request<Record<string, unknown>>(`/orders/${encodeURIComponent(providerOrderId)}/cancel`, { method: 'POST', body: JSON.stringify({}) });
    const data = required(result.data, ['status']);
    return { status: String(data.status) };
  }

  async getBalance(): Promise<FutBalance> {
    const result = await request<Record<string, unknown>>('/balance', { method: 'GET' });
    const data = required(result.data, ['balanceMinor', 'currency']);
    return { balanceMinor: Number(data.balanceMinor), currency: String(data.currency) };
  }
}

export function mapFutStatus(status: string): 'SUBMITTED_TO_FUT' | 'PROCESSING' | 'CUSTOMER_ACTION_REQUIRED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' {
  switch (status.toUpperCase()) {
    case 'SUBMITTED': case 'ACCEPTED': case 'QUEUED': return 'SUBMITTED_TO_FUT';
    case 'PROCESSING': case 'IN_PROGRESS': return 'PROCESSING';
    case 'ACTION_REQUIRED': case 'CUSTOMER_ACTION_REQUIRED': return 'CUSTOMER_ACTION_REQUIRED';
    case 'COMPLETED': case 'SUCCESS': case 'FULFILLED': return 'COMPLETED';
    case 'CANCELLED': case 'CANCELED': return 'CANCELLED';
    case 'FAILED': case 'ERROR': case 'REJECTED': return 'FAILED';
    default: return 'PROCESSING';
  }
}

export const defaultFutProvider = () => new HttpFutProvider();
export const newCorrelationId = () => randomUUID();
