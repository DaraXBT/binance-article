import { describe, expect, it, vi } from 'vitest';

import {
  parseRuntimeTargets,
  runRuntimeEnvironmentCheck,
  validateRuntimeEnvironment,
} from './check-runtime-env.mjs';

const validWeb = {
  NODE_ENV: 'test' as const,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/xarticle',
  BETTER_AUTH_SECRET: 'a'.repeat(48),
  BETTER_AUTH_URL: 'http://localhost:3000',
  GOOGLE_CLIENT_ID: 'client',
  GOOGLE_CLIENT_SECRET: 'secret',
  GEMINI_API_KEY: 'gemini',
  AI_CREDENTIAL_KEYRING: JSON.stringify({
    v1: Buffer.alloc(32, 1).toString('base64url'),
  }),
  AI_CREDENTIAL_ACTIVE_KEY_ID: 'v1',
};

describe('runtime environment preflight', () => {
  it('accepts the complete web environment without exposing values', async () => {
    const log = vi.fn();
    const error = vi.fn();
    await expect(runRuntimeEnvironmentCheck({
      argv: ['--target', 'web'], environment: validWeb, log, error,
    })).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith('Runtime environment is valid for web.');
    expect(error).not.toHaveBeenCalled();
  });

  it('rejects legacy SQLite URLs and reports names without values', () => {
    const errors = validateRuntimeEnvironment({ ...validWeb, DATABASE_URL: 'file:./dev.db' });
    expect(errors).toContain('DATABASE_URL must use PostgreSQL and include a host and database name.');
    expect(errors.join(' ')).not.toContain('dev.db');
  });

  it('requires TLS for remote PostgreSQL', () => {
    expect(validateRuntimeEnvironment({
      ...validWeb,
      DATABASE_URL: 'postgresql://user:pass@db.example.com/xarticle',
    })).toContain('Remote DATABASE_URL must include sslmode=require.');
  });

  it('validates the optional worker target sets', () => {
    expect(validateRuntimeEnvironment({ DATABASE_URL: validWeb.DATABASE_URL }, ['workflow']))
      .toContain('GEMINI_API_KEY is required.');
    expect(validateRuntimeEnvironment({}, ['all'])).toEqual(expect.arrayContaining([
      'DATABASE_URL is required.',
      'GEMINI_API_KEY is required.',
    ]));
  });

  it('rejects malformed or non-canonical credential keyrings without echoing values', () => {
    const secretValue = `${'A'.repeat(42)}B`;
    const errors = validateRuntimeEnvironment({
      ...validWeb,
      AI_CREDENTIAL_KEYRING: JSON.stringify({ v1: secretValue }),
    });
    expect(errors).toContain('AI_CREDENTIAL_KEYRING values must decode to 32 bytes.');
    expect(errors.join(' ')).not.toContain(secretValue);
  });

  it('rejects active key IDs with surrounding whitespace', () => {
    const errors = validateRuntimeEnvironment({
      ...validWeb,
      AI_CREDENTIAL_ACTIVE_KEY_ID: ' v1 ',
    });
    expect(errors).toContain('AI_CREDENTIAL_ACTIVE_KEY_ID must be a canonical key ID.');
  });

  it('parses strict target arguments', () => {
    expect(parseRuntimeTargets([])).toEqual(['web']);
    expect(parseRuntimeTargets(['--target', 'workflow'])).toEqual(['workflow']);
    expect(() => parseRuntimeTargets(['workflow'])).toThrow('Usage:');
  });
});
