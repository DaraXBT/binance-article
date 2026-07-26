import { beforeEach, describe, expect, it, vi } from 'vitest';

const createDatabase = vi.hoisted(() => vi.fn(() => ({ db: true })));
vi.mock('./client', () => ({ createDatabase }));

import { getRuntimeDatabase, resetRuntimeDatabaseForTests } from './runtime';

describe('database runtime', () => {
  beforeEach(() => {
    createDatabase.mockClear();
    resetRuntimeDatabaseForTests();
  });

  it('lazily creates one Neon HTTP client per Worker isolate', () => {
    const env = { DATABASE_URL: 'postgresql://user:pass@ep.neon.tech/app?sslmode=require' };
    const first = getRuntimeDatabase(env);
    const second = getRuntimeDatabase(env);

    expect(first).toBe(second);
    expect(createDatabase).toHaveBeenCalledTimes(1);
    expect(createDatabase).toHaveBeenCalledWith(env.DATABASE_URL);
  });

  it('fails closed without DATABASE_URL', () => {
    expect(() => getRuntimeDatabase({})).toThrow('DATABASE_URL');
    expect(createDatabase).not.toHaveBeenCalled();
  });

  it('serves the cached client even when a later call omits DATABASE_URL', () => {
    const env = { DATABASE_URL: 'postgresql://user:pass@ep.neon.tech/app?sslmode=require' };
    const seeded = getRuntimeDatabase(env);

    expect(getRuntimeDatabase({})).toBe(seeded);
    expect(getRuntimeDatabase()).toBe(seeded);
    expect(createDatabase).toHaveBeenCalledTimes(1);
  });
});
