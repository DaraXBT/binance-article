import { describe, expect, it } from 'vitest';

import { assertNeonDatabaseUrl, createDatabase } from './client';

describe('Neon database client', () => {
  it.each([undefined, '', 'sqlite:./dev.db', 'http://db.example.test/app'])
    ('rejects missing or unsupported runtime database URLs', (value) => {
      expect(() => assertNeonDatabaseUrl(value)).toThrow();
    });

  it('requires TLS for non-local PostgreSQL connections', () => {
    expect(() => assertNeonDatabaseUrl('postgresql://user:pass@ep-example.neon.tech/app'))
      .toThrow(/sslmode=require/i);
    expect(assertNeonDatabaseUrl('postgresql://user:pass@ep-example.neon.tech/app?sslmode=require'))
      .toBe('postgresql://user:pass@ep-example.neon.tech/app?sslmode=require');
  });

  it('allows an explicit local PostgreSQL URL for tests and development', () => {
    expect(assertNeonDatabaseUrl('postgresql://postgres:postgres@localhost:5432/xarticle'))
      .toBe('postgresql://postgres:postgres@localhost:5432/xarticle');
  });

  it('constructs a Drizzle database without opening a connection eagerly', () => {
    const db = createDatabase('postgresql://user:pass@ep-example.neon.tech/app?sslmode=require');
    expect(db).toBeDefined();
    expect(typeof db.select).toBe('function');
  });
});
