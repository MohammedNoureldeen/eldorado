import { UserRole, UserStatus } from '@prisma/client';
import { AppError } from '@/lib/errors';

export type AuthUser = { id: string; organizationId: string; role: UserRole; status: UserStatus; name: string; email: string; workerProfile?: { telegramChatId: string | null } | null };

export function assertActive(user: AuthUser): void {
  if (user.status !== UserStatus.ACTIVE) throw new AppError(403, 'User access is not active', 'USER_INACTIVE');
}

export function assertRole(user: AuthUser, ...roles: UserRole[]): void {
  assertActive(user);
  if (!roles.includes(user.role)) throw new AppError(403, 'This action is not allowed for your role', 'FORBIDDEN');
}

export function canAccessOrder(user: AuthUser, assignedWorkerId: string | null, status: string): boolean {
  if (user.role === UserRole.OWNER_ADMIN) return true;
  return assignedWorkerId === user.id && !['CANCELLED', 'REFUNDED'].includes(status);
}
