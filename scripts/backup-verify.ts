import assert from 'node:assert/strict';
import { db } from '../src/lib/db';

async function main() {
  const [orders, statusHistory, financialEntries, auditEvents, credentials, payrollPeriods, migrations] = await Promise.all([
    db.order.count(),
    db.orderStatusHistory.count(),
    db.financialEntry.count(),
    db.auditEvent.count(),
    db.customerCredential.count(),
    db.payrollPeriod.count(),
    db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`
  ]);
  const timeline = await db.order.findFirst({ where: { statusHistory: { some: {} } }, include: { statusHistory: true, financialEntries: true, credentials: true }, orderBy: { createdAt: 'desc' } });
  assert(timeline && timeline.statusHistory.length > 0);
  assert(migrations[0]?.count && migrations[0].count >= 3n);
  console.log(JSON.stringify({ orders, statusHistory, financialEntries, auditEvents, credentials, payrollPeriods, migrations: Number(migrations[0].count), sample: { orderReference: timeline.orderReference, timelineEvents: timeline.statusHistory.length, ledgerEntries: timeline.financialEntries.length, credentialsDeleted: timeline.credentials?.deletedAt != null } }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
