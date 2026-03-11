import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

type AppErrorOptions = {
  code: string;
  message: string;
  status: number;
  cause?: unknown;
};

export class AppError extends Error {
  code: string;
  status: number;
  cause?: unknown;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code;
    this.status = options.status;
    this.cause = options.cause;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

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
    return new AppError({
      code: 'VALIDATION_ERROR',
      message: error.issues[0]?.message || 'The request payload is invalid.',
      status: 400,
      cause: error,
    });
  }

  if (error instanceof Error && /not found/i.test(error.message)) {
    return new AppError({
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
      status: 404,
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
