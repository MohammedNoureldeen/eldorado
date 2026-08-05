import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { hashPassword } from '../src/lib/auth/password';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.invalid').toLowerCase();
  const workerEmail = (process.env.SEED_WORKER_EMAIL ?? 'worker@example.invalid').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe-Admin-123!';
  const workerPassword = process.env.SEED_WORKER_PASSWORD ?? 'ChangeMe-Worker-123!';
  const organization = await prisma.organization.upsert({ where: { id: '00000000-0000-0000-0000-000000000001' }, update: {}, create: { id: '00000000-0000-0000-0000-000000000001', name: 'Eldorado FC', baseCurrency: 'EGP', timezone: 'Africa/Cairo' } });
  const admin = await prisma.user.upsert({ where: { organizationId_email: { organizationId: organization.id, email: adminEmail } }, update: { passwordHash: await hashPassword(adminPassword), status: UserStatus.ACTIVE }, create: { organizationId: organization.id, email: adminEmail, name: 'Owner Admin', role: UserRole.OWNER_ADMIN, status: UserStatus.ACTIVE, passwordHash: await hashPassword(adminPassword), passwordChangedAt: new Date() } });
  const worker = await prisma.user.upsert({ where: { organizationId_email: { organizationId: organization.id, email: workerEmail } }, update: { passwordHash: await hashPassword(workerPassword), status: UserStatus.ACTIVE }, create: { organizationId: organization.id, email: workerEmail, name: 'Operations Worker', role: UserRole.WORKER, status: UserStatus.ACTIVE, passwordHash: await hashPassword(workerPassword), passwordChangedAt: new Date() } });
  await prisma.workerProfile.upsert({ where: { userId: worker.id }, update: {}, create: { userId: worker.id, organizationId: organization.id, employmentStart: new Date() } });
  await prisma.salaryPolicy.upsert({ where: { id: '00000000-0000-0000-0000-000000000002' }, update: {}, create: { id: '00000000-0000-0000-0000-000000000002', organizationId: organization.id, name: 'Initial salary policy', tiersJson: [{ name: 'under-200', minCompleted: 0, baseSalaryMinor: 300000 }, { name: '200-249', minCompleted: 200, baseSalaryMinor: 350000 }, { name: '250+', minCompleted: 250, baseSalaryMinor: 500000 }], bonusInterval: 10, bonusAmountMinor: 15000, effectiveFrom: new Date('2026-01-01T00:00:00.000Z') } });
  console.log(`Seeded ${organization.name}: ${admin.email}, ${worker.email}`);
}

main().finally(() => prisma.$disconnect());
