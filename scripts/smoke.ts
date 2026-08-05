import { env } from '../src/lib/config';
import { InMemoryOrderWorkflow } from '../src/lib/testing/workflow';

env.credentialKeys = JSON.stringify({ v1: Buffer.alloc(32, 9).toString('base64') });
env.credentialActiveKeyVersion = 'v1';

const provider = {
  getPrice: async () => ({ costMinor: 400_000, currency: 'EGP' }),
  createOrder: async () => ({ providerOrderId: 'smoke-provider-order', status: 'SUBMITTED', actualCostMinor: 420_000, currency: 'EGP' }),
  getStatus: async () => ({ providerOrderId: 'smoke-provider-order', status: 'COMPLETED', actualCostMinor: 420_000, currency: 'EGP' }),
  cancelOrder: async () => ({ status: 'CANCELLED' }),
  getBalance: async () => ({ balanceMinor: 1_000_000, currency: 'EGP' })
};

async function main() {
  const order = new InMemoryOrderWorkflow();
  order.saveCredentials('customer@example.com', 'customer-password');
  order.move('WAITING_FOR_DETAILS'); order.move('READY_FOR_REVIEW'); await order.prepare(provider); order.move('APPROVED'); await order.confirm(provider); order.uploadProof(); order.complete();
  if (order.profit() !== 580_000 || order.reveal().email !== 'customer@example.com') throw new Error('End-to-end smoke workflow failed');
  console.log('Eldorado smoke workflow passed');
}

void main();
