import { describe, expect, it, vi } from 'vitest';

import {
  runProductionMigrationTargetCheck,
  validateProductionMigrationTarget,
  verifyProductionMigrationTarget,
} from './check-production-migration-target.mjs';

const validEnvironment = {
  MIGRATION_DATABASE_URL:
    'postgresql://migration_role:synthetic-password@db.example.invalid:5432/app?sslmode=require',
  EXPECTED_PRODUCTION_DATABASE_AUTHORITY: 'db.example.invalid:5432',
  EXPECTED_PRODUCTION_DATABASE_NAME: 'app',
  EXPECTED_PRODUCTION_MIGRATION_ROLE: 'migration_role',
};

describe('production migration target check', () => {
  it('accepts an exact remote PostgreSQL target without returning connection material', () => {
    expect(validateProductionMigrationTarget(validEnvironment)).toBeUndefined();
  });

  it('connects read-only and verifies the database and role without returning identity data', async () => {
    const query = vi.fn(async () => ([{
      databaseName: 'app',
      migrationRole: 'migration_role',
    }]));
    const createSql = vi.fn(() => query);

    await expect(verifyProductionMigrationTarget({
      environment: validEnvironment,
      createSql,
    })).resolves.toBeUndefined();

    expect(createSql).toHaveBeenCalledWith(validEnvironment.MIGRATION_DATABASE_URL);
    expect(query).toHaveBeenCalledOnce();
    const [strings] = query.mock.calls[0] as unknown as [TemplateStringsArray];
    expect(strings.join('')).toMatch(/current_database\(\)[\s\S]*current_user/);
  });

  it('rejects a connected database or role mismatch with the fixed safe error', async () => {
    const createSql = vi.fn(() => vi.fn(async () => ([{
      databaseName: 'unexpected',
      migrationRole: 'migration_role',
    }])));

    await expect(verifyProductionMigrationTarget({
      environment: validEnvironment,
      createSql,
    })).rejects.toThrow('Production migration target check failed.');
  });

  it.each([
    { MIGRATION_DATABASE_URL: undefined },
    { MIGRATION_DATABASE_URL: 'https://db.example.invalid/app?sslmode=require' },
    { MIGRATION_DATABASE_URL: 'postgresql://migration_role:password@localhost/app?sslmode=require' },
    { MIGRATION_DATABASE_URL: 'postgresql://migration_role:password@db.example.invalid/app' },
    { MIGRATION_DATABASE_URL: 'postgresql://migration_role:password@db.example.invalid/app?sslmode=require&sslmode=disable' },
    { MIGRATION_DATABASE_URL: 'postgresql://:password@db.example.invalid/app?sslmode=require' },
    { MIGRATION_DATABASE_URL: 'postgresql://migration_role:password@db.example.invalid/?sslmode=require' },
  ])('rejects an incomplete or unsafe production URL: %o', (override) => {
    expect(() => validateProductionMigrationTarget({
      ...validEnvironment,
      ...override,
    })).toThrow('Production migration target check failed.');
  });

  it.each([
    { EXPECTED_PRODUCTION_DATABASE_AUTHORITY: 'db.example.invalid' },
    { EXPECTED_PRODUCTION_DATABASE_NAME: 'other_app' },
    { EXPECTED_PRODUCTION_MIGRATION_ROLE: 'other_role' },
  ])('rejects target identifier drift: %o', (override) => {
    expect(() => validateProductionMigrationTarget({
      ...validEnvironment,
      ...override,
    })).toThrow('Production migration target check failed.');
  });

  it('fails silently without echoing a malformed secret-bearing URL', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const secretSentinel = 'DO_NOT_ECHO_DATABASE_SECRET';

    await expect(runProductionMigrationTargetCheck({
      environment: {
        ...validEnvironment,
        MIGRATION_DATABASE_URL: `postgresql://migration_role:${secretSentinel}@[invalid`,
      },
      log,
      error,
    })).resolves.toBe(1);

    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('Production migration target check failed.');
    expect(JSON.stringify(error.mock.calls)).not.toContain(secretSentinel);
  });
});
