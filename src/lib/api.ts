import { NextRequest } from 'next/server';
import { AppError } from '@/lib/errors';

export async function readJson<T>(request: NextRequest): Promise<T> {
  try { return await request.json() as T; } catch { throw new AppError(400, 'Request body must be valid JSON', 'INVALID_JSON'); }
}

export function requestIp(request: NextRequest): string | undefined {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || undefined;
}
