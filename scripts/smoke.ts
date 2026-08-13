import { env } from '../src/lib/config';
import { InMemoryOrderWorkflow } from '../src/lib/testing/workflow';
import type { FutProvider } from '../src/lib/integrations/fut';

env.credentialKeys = JSON.stringify({ v1: Buffer.alloc(32, 9).toString('base64') });
env.credentialActiveKeyVersion = 'v1';

const provider: FutProvider = {
  getPrice: async () => ({ costMinor: 4_000, currency: 'USD' }),
  createOrder: async () => ({ providerOrderId: 'smoke-provider-order', status: 'entered', actualCostMinor: 4_200, currency: 'USD' }),
  getStatus: async () => ({ providerOrderId: 'smoke-provider-order', status: 'finished', actualCostMinor: 4_200, currency: 'USD' }),
  cancelOrder: async () => ({ status: 'CANCELLED' }),
  getBalance: async () => ({ balanceMinor: 100_000, currency: 'USD' })
};

async function main() {
  const order = new InMemoryOrderWorkflow();
  order.saveCredentials('customer@example.com', 'customer-password');
  order.move('WAITING_FOR_DETAILS'); order.move('READY_FOR_REVIEW'); await order.prepare(provider); order.move('APPROVED'); await order.confirm(provider); order.uploadProof(); order.complete();
  if (order.profit() !== 5_800 || order.reveal().email !== 'customer@example.com') throw new Error('End-to-end smoke workflow failed');
  console.log('Eldorado smoke workflow passed');
}

void main();
