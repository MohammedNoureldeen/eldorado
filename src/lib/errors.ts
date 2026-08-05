export class AppError extends Error {
  constructor(public readonly status: number, message: string, public readonly code = 'APP_ERROR') {
    super(message);
    this.name = 'AppError';
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  console.error('Unhandled application error', error instanceof Error ? error.message : error);
  return Response.json({ error: 'Unexpected server error', code: 'INTERNAL_ERROR' }, { status: 500 });
}

export function assert(condition: unknown, status: number, message: string, code = 'VALIDATION_ERROR'): asserts condition {
  if (!condition) throw new AppError(status, message, code);
}
