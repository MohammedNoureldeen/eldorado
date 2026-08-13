import { randomUUID } from 'node:crypto';
import { FulfillmentSource } from '@prisma/client';
import { env } from '@/lib/config';

export type FutCredentials = { customerName: string; email: string; password: string; backupCodes: string[] };
export type FutPrice = {
  costMinor: number;
  currency: string;
  expiresAt?: string;
  supplierId?: string;
  isPublicSupplier?: boolean;
  senderGroup?: string;
  capacityK?: number;
};
export type FutCreateInput = {
  platform: string;
  coinQuantity: number;
  externalOrderId: string;
  expectedCostMinor: number;
  currency: string;
  fulfillmentSource: FulfillmentSource;
  credentials: FutCredentials;
  supplierId?: string;
  isPublicSupplier?: boolean;
  senderGroup?: string;
};
export type FutCreateResult = { providerOrderId: string; status: string; actualCostMinor?: number; currency?: string; rawMetadata?: unknown };
export type FutStatusResult = {
  providerOrderId?: string;
  status: string;
  accountCheck?: string;
  economyState?: string;
  deliveredK?: number;
  orderedK?: number;
  actualCostMinor?: number;
  currency?: string;
  wasAborted?: boolean;
  rawMetadata?: unknown;
};
export type FutBalance = { balanceMinor: number; currency: string };
export type FutStatusInterpretation = {
  orderStatus: 'SUBMITTED_TO_FUT' | 'PROCESSING' | 'CUSTOMER_ACTION_REQUIRED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  instruction?: string;
  unknownCode?: string;
};

export interface FutProvider {
  getPrice(input: { platform: string; coinQuantity: number; fulfillmentSource: FulfillmentSource }): Promise<FutPrice>;
  createOrder(input: FutCreateInput): Promise<FutCreateResult>;
  getStatus(input: { providerOrderId?: string; externalOrderId?: string }): Promise<FutStatusResult>;
  correctCredentials?(input: { providerOrderId?: string; externalOrderId?: string; credentials: FutCredentials; platform: string; resume: boolean }): Promise<{ status: string; rawMetadata?: unknown }>;
  resumeOrder?(providerOrderId: string): Promise<{ status: string }>;
  cancelOrder(providerOrderId: string): Promise<{ status: string }>;
  getBalance(): Promise<FutBalance>;
}

export class FutProviderError extends Error {
  constructor(message: string, public readonly code: 'TIMEOUT' | 'AUTHENTICATION' | 'RATE_LIMIT' | 'INSUFFICIENT_BALANCE' | 'NO_STOCK' | 'PRICE_CHANGED' | 'PROVIDER' | 'MALFORMED_RESPONSE', public readonly retryable: boolean, public readonly status?: number, public readonly ambiguous = false) {
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
function wait(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

function authBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!env.futApiUser || !env.futApiKeyMd5) throw new FutProviderError('FUT credentials are not configured', 'AUTHENTICATION', false);
  return { ...body, apiUser: env.futApiUser, apiKey: env.futApiKeyMd5 };
}

async function request<T>(path: string, body: Record<string, unknown>, options: { retries?: number; ambiguousOnTransportFailure?: boolean } = {}): Promise<{ data: T; status: number; metadata: unknown }> {
  if (!env.futBaseUrl) throw new FutProviderError('FUT base URL is not configured', 'PROVIDER', false);
  assertCircuit();
  const retries = options.retries ?? env.futMaxRetries;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.futTimeoutMs);
    try {
      const response = await fetch(new URL(path, env.futBaseUrl), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(authBody(body))
      });
      const text = await response.text();
      let data: unknown = {};
      if (text) {
        try { data = JSON.parse(text); } catch { if (response.ok) throw new FutProviderError('FUT returned malformed JSON', 'MALFORMED_RESPONSE', false, response.status); }
      }
      const metadata = { status: response.status, bodyKeys: data && typeof data === 'object' ? Object.keys(data) : [] };
      if (response.ok) { success(); return { data: data as T, status: response.status, metadata }; }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (response.status === 401 || response.status === 403) throw new FutProviderError('FUT authentication failed', 'AUTHENTICATION', false, response.status);
      if (response.status === 402) throw new FutProviderError('FUT balance is insufficient', 'INSUFFICIENT_BALANCE', false, response.status);
      if (response.status === 406) throw new FutProviderError('FUT supplier stock is unavailable', 'NO_STOCK', false, response.status);
      if (!retryable || attempt === retries) throw new FutProviderError('FUT request failed', response.status === 429 ? 'RATE_LIMIT' : 'PROVIDER', retryable, response.status);
      await wait(Math.min(1000 * 2 ** attempt, 4000));
    } catch (error) {
      if (error instanceof FutProviderError && !error.retryable) { failure(); throw error; }
      if (error instanceof FutProviderError && attempt === retries) { failure(); throw error; }
      if (error instanceof Error && error.name === 'AbortError' && attempt === retries) {
        failure();
        throw new FutProviderError('FUT request timed out', 'TIMEOUT', true, undefined, options.ambiguousOnTransportFailure === true);
      }
      if (attempt === retries) {
        failure();
        throw new FutProviderError('FUT request failed', 'PROVIDER', true, undefined, options.ambiguousOnTransportFailure === true);
      }
      await wait(Math.min(1000 * 2 ** attempt, 4000));
    } finally { clearTimeout(timeout); }
  }
  throw new FutProviderError('FUT request failed', 'PROVIDER', true);
}

function record(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new FutProviderError('FUT returned an invalid response', 'MALFORMED_RESPONSE', false);
  return data as Record<string, unknown>;
}

function requiredString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim()) throw new FutProviderError('FUT returned an incomplete response', 'MALFORMED_RESPONSE', false);
  return value;
}

function finiteNumber(value: unknown, field: string): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw new FutProviderError(`FUT returned an invalid ${field}`, 'MALFORMED_RESPONSE', false);
  return number;
}

function decimalToMinor(value: unknown): number {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) throw new FutProviderError('FUT returned an invalid USD amount', 'MALFORMED_RESPONSE', false);
  const [whole, fraction = ''] = text.split('.');
  const padded = `${fraction}000`;
  const minor = Number(whole) * 100 + Number(padded.slice(0, 2)) + (Number(padded[2]) >= 5 ? 1 : 0);
  if (!Number.isSafeInteger(minor)) throw new FutProviderError('FUT returned an unsafe USD amount', 'MALFORMED_RESPONSE', false);
  return minor;
}

function quantityK(coinQuantity: number): number {
  if (!Number.isInteger(coinQuantity) || coinQuantity < 1_000 || coinQuantity % 1_000 !== 0) throw new FutProviderError('Coin quantity must be an integer number of thousands', 'PROVIDER', false);
  return coinQuantity / 1_000;
}

function platformFields(platform: string): { futPlatform: 'PS' | 'XB' | 'PC'; price: 'priceConsole' | 'pricePC'; stock: 'stockConsole' | 'stockPC' } {
  const normalized = platform.toUpperCase();
  if (normalized === 'PC') return { futPlatform: 'PC', price: 'pricePC', stock: 'stockPC' };
  if (normalized === 'XBOX' || normalized === 'XB') return { futPlatform: 'XB', price: 'priceConsole', stock: 'stockConsole' };
  if (normalized === 'PLAYSTATION' || normalized === 'PS') return { futPlatform: 'PS', price: 'priceConsole', stock: 'stockConsole' };
  throw new FutProviderError('Unsupported FUT platform', 'PROVIDER', false);
}

function credentialsBody(credentials: FutCredentials): Record<string, unknown> {
  const [ba, ba2, ba3, ba4, ba5] = credentials.backupCodes.map((code) => code.trim()).filter(Boolean).slice(0, 5);
  if (!ba) throw new FutProviderError('At least one backup code is required', 'PROVIDER', false);
  return { customerName: credentials.customerName, user: credentials.email, pass: credentials.password, ba, ...(ba2 ? { ba2 } : {}), ...(ba3 ? { ba3 } : {}), ...(ba4 ? { ba4 } : {}), ...(ba5 ? { ba5 } : {}) };
}

export class HttpFutProvider implements FutProvider {
  async getPrice(input: { platform: string; coinQuantity: number; fulfillmentSource: FulfillmentSource }): Promise<FutPrice> {
    const amount = quantityK(input.coinQuantity);
    const platform = platformFields(input.platform);
    if (input.fulfillmentSource === FulfillmentSource.OWNED_SENDERS) {
      const result = await request<Record<string, unknown>>('/availableStockAPI', {});
      const data = record(result.data);
      const capacityK = Math.trunc(finiteNumber(data[platform.futPlatform === 'PC' ? 'maxOrderPC' : 'maxOrderConsole'], 'available stock'));
      if (capacityK < amount) throw new FutProviderError('Owned sender stock cannot fulfill this order', 'NO_STOCK', false, 406);
      return { costMinor: Math.round(env.futOwnedCostPer100kMinor * amount / 100), currency: 'USD', expiresAt: new Date(Date.now() + 60_000).toISOString(), senderGroup: '-1', capacityK };
    }
    const result = await request<Record<string, unknown>>('/buyConditionAPI', { platform: platform.futPlatform === 'PC' ? 'PC' : 'PS', amount, fullPrices: 'full' });
    const data = record(result.data);
    const suppliers = Array.isArray(data.suppliers) ? data.suppliers.map(record) : [];
    const eligible = suppliers.filter((supplier) => finiteNumber(supplier[platform.stock], platform.stock) >= amount && finiteNumber(supplier[platform.price], platform.price) > 0);
    if (!eligible.length) throw new FutProviderError('No public FUT supplier can fulfill this order', 'NO_STOCK', false, 406);
    eligible.sort((a, b) => finiteNumber(a[platform.price], platform.price) - finiteNumber(b[platform.price], platform.price));
    const supplier = eligible[0];
    const pricePer100kMinor = decimalToMinor(supplier[platform.price]);
    return { costMinor: Math.round(pricePer100kMinor * amount / 100), currency: 'USD', expiresAt: new Date(Date.now() + 60_000).toISOString(), supplierId: String(supplier.supplierID), isPublicSupplier: true, capacityK: Math.trunc(finiteNumber(supplier[platform.stock], platform.stock)) };
  }

  async createOrder(input: FutCreateInput): Promise<FutCreateResult> {
    const platform = platformFields(input.platform);
    const base = { ...credentialsBody(input.credentials), platform: platform.futPlatform, amount: quantityK(input.coinQuantity), externalOrderID: input.externalOrderId };
    const path = input.fulfillmentSource === FulfillmentSource.PUBLIC_SUPPLIER ? '/buyCoinsAPI' : '/orderAPI';
    const body = input.fulfillmentSource === FulfillmentSource.PUBLIC_SUPPLIER
      ? { ...base, supplierID: input.supplierId, privateSupplier: input.isPublicSupplier === false ? '1' : '0', transferMethod: 'snipe', maxPrice: input.expectedCostMinor / 100 / (input.coinQuantity / 100_000) }
      : { ...base, persona: '-1', senderGroup: input.senderGroup ?? '-1', transferMethod: 'snipe' };
    if (input.fulfillmentSource === FulfillmentSource.PUBLIC_SUPPLIER && !input.supplierId) throw new FutProviderError('Prepared supplier selection is missing', 'PROVIDER', false);
    // Submission is deliberately never retried. A transport failure is persisted as UNKNOWN and recovered by externalOrderID.
    const result = await request<Record<string, unknown>>(path, body, { retries: 0, ambiguousOnTransportFailure: true });
    const data = record(result.data);
    return { providerOrderId: requiredString(data, 'orderID'), status: 'entered', actualCostMinor: input.expectedCostMinor, currency: 'USD', rawMetadata: result.metadata };
  }

  async getStatus(input: { providerOrderId?: string; externalOrderId?: string }): Promise<FutStatusResult> {
    const orderID = input.providerOrderId ?? input.externalOrderId;
    if (!orderID) throw new FutProviderError('A FUT order identifier is required', 'PROVIDER', false);
    const result = await request<Record<string, unknown>>('/orderStatusAPI', { orderID, externalID: input.providerOrderId ? 0 : 1, isMotherID: 0 });
    const data = record(result.data);
    const status = requiredString(data, 'status');
    const toPay = data.toPay == null ? undefined : decimalToMinor(data.toPay);
    return {
      providerOrderId: input.providerOrderId ?? (typeof data.orderID === 'string' ? data.orderID : undefined),
      status,
      accountCheck: typeof data.accountCheck === 'string' ? data.accountCheck : undefined,
      economyState: typeof data.economyState === 'string' ? data.economyState : undefined,
      deliveredK: data.amount == null ? undefined : Math.trunc(finiteNumber(data.amount, 'delivered amount')),
      orderedK: data.amountOrdered == null ? undefined : Math.trunc(finiteNumber(data.amountOrdered, 'ordered amount')),
      actualCostMinor: toPay,
      currency: toPay == null ? undefined : 'USD',
      wasAborted: Number(data.wasAborted) === 1,
      rawMetadata: result.metadata
    };
  }

  async cancelOrder(providerOrderId: string): Promise<{ status: string }> {
    const result = await request<Record<string, unknown>>('/resumeOrderAPI', { orderID: providerOrderId, mode: 'stop' }, { retries: 0, ambiguousOnTransportFailure: true });
    return { status: requiredString(record(result.data), 'outcome') };
  }

  async correctCredentials(input: { providerOrderId?: string; externalOrderId?: string; credentials: FutCredentials; platform: string; resume: boolean }): Promise<{ status: string; rawMetadata?: unknown }> {
    const orderID = input.providerOrderId ?? input.externalOrderId;
    if (!orderID) throw new FutProviderError('A FUT order identifier is required', 'PROVIDER', false);
    const result = await request<Record<string, unknown>>('/correctCredentialsAPI', { orderID, externalOrderID: input.providerOrderId ? 0 : 1, ...credentialsBody(input.credentials), platform: platformFields(input.platform).futPlatform, continue: input.resume ? 1 : 0 }, { retries: 0, ambiguousOnTransportFailure: true });
    const data = record(result.data);
    return { status: data.wasContinued === true ? 'resumed' : 'updated', rawMetadata: result.metadata };
  }

  async resumeOrder(providerOrderId: string): Promise<{ status: string }> {
    const result = await request<Record<string, unknown>>('/resumeOrderAPI', { orderID: providerOrderId, mode: 'resume' }, { retries: 0, ambiguousOnTransportFailure: true });
    return { status: requiredString(record(result.data), 'outcome') };
  }

  async getBalance(): Promise<FutBalance> {
    const result = await request<Record<string, unknown>>('/buyConditionAPI', { fullPrices: 'full' });
    const balance = record(result.data).balance;
    return { balanceMinor: decimalToMinor(balance), currency: 'USD' };
  }
}

export class FakeFutProvider implements FutProvider {
  async getPrice(input: { platform: string; coinQuantity: number; fulfillmentSource: FulfillmentSource }): Promise<FutPrice> {
    const platformMultiplier = input.platform === 'PC' ? 105 : 100;
    const costMinor = input.fulfillmentSource === FulfillmentSource.OWNED_SENDERS ? 0 : Math.round(Math.ceil(input.coinQuantity / 100_000) * 550 * platformMultiplier / 100);
    return { costMinor, currency: 'USD', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), ...(input.fulfillmentSource === FulfillmentSource.PUBLIC_SUPPLIER ? { supplierId: 'fake-public', isPublicSupplier: true } : { senderGroup: '-1' }) };
  }

  async createOrder(input: FutCreateInput): Promise<FutCreateResult> {
    return { providerOrderId: `fake-${input.externalOrderId}-${input.expectedCostMinor}`, status: 'entered', actualCostMinor: input.expectedCostMinor, currency: 'USD', rawMetadata: { mode: 'fake' } };
  }

  async getStatus(input: { providerOrderId?: string; externalOrderId?: string }): Promise<FutStatusResult> {
    const providerOrderId = input.providerOrderId ?? `fake-${input.externalOrderId}-0`;
    const actualCostMinor = Number(providerOrderId.split('-').at(-1));
    return { providerOrderId, status: 'finished', accountCheck: 'finished', economyState: 'finished', actualCostMinor: Number.isSafeInteger(actualCostMinor) ? actualCostMinor : undefined, currency: 'USD', rawMetadata: { mode: 'fake' } };
  }

  async cancelOrder(): Promise<{ status: string }> { return { status: 'stopped' }; }
  async correctCredentials(): Promise<{ status: string }> { return { status: 'resumed' }; }
  async resumeOrder(): Promise<{ status: string }> { return { status: 'resumed' }; }
  async getBalance(): Promise<FutBalance> { return { balanceMinor: 100_000, currency: 'USD' }; }
}

const actionInstructions: Record<string, string> = {
  wrongba: 'Ask the customer for a new EA backup code, correct the credentials, then resume.',
  wronguserpass: 'Ask the customer for the correct EA email and password, then resume.',
  captcha: 'Ask the customer to solve the EA captcha, then resume.',
  console: 'Ask the customer to log out from the console, then resume.',
  tlfull: 'Ask the customer to free at least three transfer-list and transfer-target slots, then resume.',
  unassigneditemspresent: 'Ask the customer to reduce unassigned items below 50, then resume.',
  notenoughcoins: 'Ask the customer to keep at least 1,500 coins in the account, then resume.',
  wrongpersona: 'Select the correct EA persona or ask the customer to switch personas.',
  notm: 'This account has no Transfer Market access; request a different account.',
  noclub: 'This EA account has no usable club; request a different account.',
  wrongconsole: 'The platform/account does not match; correct the order or request another account.',
  failwebappcustomerlocked: 'The EA Web App account is locked; customer action is required.',
  failloggedinconsoleto: 'Ask the customer to log out from the console, then resume.',
  failedwrongcredentialsto: 'Ask the customer for the correct EA credentials, then resume.',
  failedwrongbacodeto: 'Ask the customer for a new EA backup code, then resume.',
  failedtlfullreceiver: 'Ask the customer to free transfer-list space, then resume.',
  failwebappnotyetunlocked: 'The EA Web App is not unlocked; request another eligible account.',
  failedreceiverdeviceban: 'The receiver device is banned; stop and escalate for a replacement account.',
  loginfaileddeviceban: 'The receiver device is banned; stop and escalate for a replacement account.',
  belowmintransfer: 'The remaining amount is below the configured minimum; resume, wait for coins, or change transfer method.'
};

export function interpretFutStatus(input: Pick<FutStatusResult, 'status' | 'accountCheck' | 'economyState' | 'wasAborted'>): FutStatusInterpretation {
  if (input.wasAborted) return { orderStatus: 'CANCELLED' };
  const status = input.status.trim().toLowerCase();
  const detailCodes = [input.accountCheck, input.economyState].filter((value): value is string => Boolean(value)).map((value) => value.trim().toLowerCase());
  for (const code of detailCodes) if (actionInstructions[code]) return { orderStatus: 'CUSTOMER_ACTION_REQUIRED', instruction: actionInstructions[code] };
  if (status === 'finished') return { orderStatus: 'COMPLETED' };
  if (status === 'partlydelivered') return { orderStatus: 'PROCESSING' };
  if (status === 'ready' || status === 'entered' || status === 'waitingforassignment') return { orderStatus: 'SUBMITTED_TO_FUT' };
  if (status === 'interrupted') return { orderStatus: 'CUSTOMER_ACTION_REQUIRED', instruction: 'Review the FUT account and economy state before resuming.' };
  if (detailCodes.some((code) => ['started', 'transfersinprogress', 'transfercyclecomplete', 'customerhasplayer', 'customerlistedplayer', 'finished', 'entered'].includes(code))) return { orderStatus: 'PROCESSING' };
  const unknownCode = [input.status, input.accountCheck, input.economyState].filter(Boolean).join(' / ');
  return { orderStatus: 'CUSTOMER_ACTION_REQUIRED', instruction: 'Unknown FUT status. Do not retry submission; escalate for manual review.', unknownCode };
}

export function mapFutStatus(status: string): FutStatusInterpretation['orderStatus'] { return interpretFutStatus({ status }).orderStatus; }

const fakeProvider = new FakeFutProvider();
export const defaultFutProvider = (): FutProvider => env.futProviderMode === 'fake' ? fakeProvider : new HttpFutProvider();
export const newCorrelationId = () => randomUUID();
