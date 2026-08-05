import { randomUUID } from 'node:crypto';
import { decryptCredentialSet, encryptCredentialSet } from '@/lib/crypto/secrets';
import { assertTransition, calculatePayroll, calculateProfit, SalaryPolicyInput, OrderStatus } from '@/lib/domain';
import { FutProvider } from '@/lib/integrations/fut';

export class InMemoryOrderWorkflow {
  readonly id = randomUUID();
  readonly audit: string[] = [];
  readonly ledger: Array<{ type: 'REVENUE' | 'MARKETPLACE_FEE' | 'FUT_COST' | 'REFUND' | 'FX_FEE' | 'ADJUSTMENT'; amountMinor: number; currency: string; egpAmountMinor?: number }> = [];
  status: OrderStatus = 'DRAFT';
  version = 1;
  credentials?: ReturnType<typeof encryptCredentialSet>;
  estimatedCostMinor = 0;
  actualCostMinor?: number;
  providerOrderId?: string;
  proofUploaded = false;
  private confirmed = false;

  saveCredentials(email: string, password: string): void { this.credentials = encryptCredentialSet({ email, password }); this.audit.push('CREDENTIALS_SAVED'); }
  move(status: OrderStatus): void { assertTransition(this.status, status); this.status = status; this.version += 1; this.audit.push(`STATUS_${status}`); }
  async prepare(provider: FutProvider): Promise<void> { if (!this.credentials) throw new Error('credentials required'); if (!['READY_FOR_REVIEW', 'APPROVED'].includes(this.status)) throw new Error('order not ready'); const price = await provider.getPrice({ platform: 'PC', coinQuantity: 100 }); this.estimatedCostMinor = price.costMinor; this.audit.push('FUT_PREPARED'); }
  async confirm(provider: FutProvider): Promise<void> { if (this.confirmed) throw new Error('duplicate confirmation'); if (this.status !== 'APPROVED') throw new Error('approval required'); if (!this.credentials) throw new Error('credentials required'); this.confirmed = true; const result = await provider.createOrder({ platform: 'PC', coinQuantity: 100, idempotencyKey: this.id, expectedCostMinor: this.estimatedCostMinor, currency: 'EGP' }); this.providerOrderId = result.providerOrderId; this.actualCostMinor = result.actualCostMinor ?? this.estimatedCostMinor; this.move('SUBMITTED_TO_FUT'); }
  uploadProof(): void { this.proofUploaded = true; this.audit.push('PROOF_UPLOADED'); }
  complete(): void { if (!this.actualCostMinor || !this.proofUploaded) throw new Error('actual cost and proof required'); this.move('PROCESSING'); this.move('COMPLETED'); this.ledger.push({ type: 'REVENUE', amountMinor: 1_000_000, currency: 'EGP', egpAmountMinor: 1_000_000 }, { type: 'FUT_COST', amountMinor: this.actualCostMinor, currency: 'EGP', egpAmountMinor: this.actualCostMinor }); this.audit.push('ORDER_RECONCILED'); }
  reveal(): { email: string; password: string; backupCodes: string[] } { if (!this.credentials) throw new Error('credentials deleted'); return decryptCredentialSet(this.credentials); }
  payroll(count: number, policy: SalaryPolicyInput) { return calculatePayroll(count, policy); }
  profit(): number { return calculateProfit(this.ledger, true); }
}
