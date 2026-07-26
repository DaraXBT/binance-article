import { describe, it, expect, vi } from 'vitest';
import { ZodError } from 'zod';
import { AppError, toAppError, errorResponse, isAppError } from './errors';

describe('toAppError', () => {
  it('preserves AppError instances unchanged', () => {
    const err = new AppError({ code: 'MY_CODE', message: 'Safe message', status: 422 });
    const result = toAppError(err);
    expect(result).toBe(err);
    expect(result.code).toBe('MY_CODE');
    expect(result.message).toBe('Safe message');
    expect(result.status).toBe(422);
  });

  it('sanitizes unknown errors — does not expose raw message', () => {
    const raw = new Error('Prisma connection pool exhausted at /var/app/node_modules/prisma');
    const result = toAppError(raw);
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.message).toBe('Something went wrong.');
    expect(result.status).toBe(500);
    expect(result.message).not.toContain('Prisma');
  });

  it('uses custom fallback for unknown errors', () => {
    const raw = new Error('Internal network timeout on 10.0.0.1:5432');
    const result = toAppError(raw, { code: 'CUSTOM', message: 'Custom fallback.' });
    expect(result.code).toBe('CUSTOM');
    expect(result.message).toBe('Custom fallback.');
    expect(result.message).not.toContain('10.0.0.1');
  });

  it('does not convert "not found" plain errors to 404 — uses fallback instead', () => {
    const raw = new Error('Record not found in database table "users" (workspace_abc)');
    const result = toAppError(raw);
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.status).toBe(500);
    expect(result.message).toBe('Something went wrong.');
    expect(result.message).not.toContain('database');
    expect(result.message).not.toContain('workspace_abc');
  });

  it('converts ZodError to VALIDATION_ERROR', () => {
    const zodError = new ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        path: ['title'],
        message: 'Expected string, received number',
      },
    ]);
    const result = toAppError(zodError);
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.status).toBe(400);
    expect(result.message).toBe('The request payload is invalid.');
  });

  it('does not leak non-Error primitives', () => {
    const result = toAppError('secret connection string');
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.message).toBe('Something went wrong.');
    expect(result.message).not.toContain('secret');
  });

  it('stores original error as cause', () => {
    const raw = new Error('raw detail');
    const result = toAppError(raw);
    expect(result.cause).toBe(raw);
  });
});

describe('isAppError', () => {
  it('returns true for AppError', () => {
    expect(isAppError(new AppError({ code: 'X', message: 'x', status: 400 }))).toBe(true);
  });

  it('returns false for plain Error', () => {
    expect(isAppError(new Error('nope'))).toBe(false);
  });
});

describe('errorResponse', () => {
  it('returns correct HTTP status and JSON body for AppError', async () => {
    const err = new AppError({ code: 'TEST_ERROR', message: 'Test message', status: 418 });
    const response = errorResponse(err);
    expect(response.status).toBe(418);
    const body = await response.json();
    expect(body).toEqual({ error: 'Test message', code: 'TEST_ERROR' });
  });

  it('sets Cache-Control: no-store header', () => {
    const err = new AppError({ code: 'X', message: 'x', status: 400 });
    const response = errorResponse(err);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('sanitizes unknown errors in response body', async () => {
    const raw = new Error('Raw database connection string: postgres://user:pass@host/db');
    const response = errorResponse(raw);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Something went wrong.');
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.error).not.toContain('postgres');
  });

  it('uses custom fallback for unknown errors', async () => {
    const raw = new Error('internal detail');
    const response = errorResponse(raw, {
      code: 'MY_FALLBACK',
      message: 'Something specific failed.',
      status: 502,
    });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ error: 'Something specific failed.', code: 'MY_FALLBACK' });
  });

  it('logs server errors (5xx) with original error details', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = new Error('Connection refused at 10.0.0.1:5432');
    errorResponse(raw);
    expect(spy).toHaveBeenCalledOnce();
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.event).toBe('api.error');
    expect(logged.cause).toContain('Connection refused');
    spy.mockRestore();
  });

  it('redacts bearer tokens, credentials, and secret-shaped values from server logs', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = new Error(
      'Bearer abcdefghijklmnopqrstuvwxyz123456 password=super-secret postgres://user:pass@db.example.com/app',
    );
    errorResponse(raw);
    const logged = JSON.parse(spy.mock.calls[0][0] as string) as { cause: string };
    expect(logged.cause).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
    expect(logged.cause).not.toContain('super-secret');
    expect(logged.cause).not.toContain('user:pass');
    spy.mockRestore();
  });

  it('redacts long base64url runs such as ciphertext echoed by the database', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ciphertext = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4Y5z6';
    errorResponse(new Error(
      `duplicate key value violates constraint DETAIL: Key (ciphertext)=(${ciphertext}) already exists.`,
    ));
    const logged = JSON.parse(spy.mock.calls[0][0] as string) as { cause: string };
    expect(logged.cause).not.toContain(ciphertext);
    expect(logged.cause).toContain('[REDACTED]');
    expect(logged.cause).toContain('duplicate key value');
    spy.mockRestore();
  });

  it('does not log client errors (4xx)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new AppError({ code: 'BAD_REQUEST', message: 'Invalid input', status: 400 });
    errorResponse(err);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
