import { assertProductionConfig } from '@/lib/config';

export function register(): void {
  if (process.env.NEXT_RUNTIME === 'nodejs') assertProductionConfig();
}
