import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { logEvent } from '@/server/http/log';
import { AppError, isAppError } from '@/server/http/app-error';

export { AppError, isAppError } from '@/server/http/app-error';

export function toAppError(
  error: unknown,
  fallback: { code: string; message: string; status?: number } = {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong.',
    status: 500,
  }
) {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof ZodError) {
    logEvent('warn', 'validation.error', {
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    });

    return new AppError({
      code: 'VALIDATION_ERROR',
      message: 'The request payload is invalid.',
      status: 400,
      cause: error,
    });
  }

  return new AppError({
    code: fallback.code,
    message: fallback.message,
    status: fallback.status ?? 500,
    cause: error,
  });
}

export function withNoStoreHeaders(headers?: HeadersInit) {
  return {
    ...headers,
    'Cache-Control': 'no-store',
  };
}

export function errorResponse(
  error: unknown,
  fallback?: { code: string; message: string; status?: number }
) {
  const appError = toAppError(error, fallback);

  if (appError.status >= 500) {
    logEvent('error', 'api.error', {
      code: appError.code,
      cause: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  return NextResponse.json(
    {
      error: appError.message,
      code: appError.code,
    },
    {
      status: appError.status,
      headers: withNoStoreHeaders(),
    }
  );
}
