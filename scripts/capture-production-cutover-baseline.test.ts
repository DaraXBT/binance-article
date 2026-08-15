import { describe, expect, it, vi } from 'vitest';

import {
  captureProductionCutoverBaseline,
  runProductionCutoverBaselineCapture,
} from './capture-production-cutover-baseline.mjs';

const validEnvironment = {
  MIGRATION_DATABASE_URL:
    'postgresql://migration_role:synthetic-password@db.example.invalid:5432/app?sslmode=require',
  EXPECTED_PRODUCTION_DATABASE_AUTHORITY: 'db.example.invalid:5432',
  EXPECTED_PRODUCTION_DATABASE_NAME: 'app',
  EXPECTED_PRODUCTION_MIGRATION_ROLE: 'migration_role',
};

const baseline = {
  cutoverStartedAt: '2026-08-15T08:30:00.123456Z',
  baselineUserCount: '7',
};

describe('production cutover baseline capture', () => {
  it('captures one timestamp/count pair through the target-verified connection', async () => {
    const query = vi.fn(async () => ([{
      databaseName: 'app',
      migrationRole: 'migration_role',
      preMigrationSchema: true,
      ...baseline,
    }]));
    const createSql = vi.fn(() => query);

    await expect(captureProductionCutoverBaseline({
      environment: validEnvironment,
      createSql,
    })).resolves.toEqual(baseline);

    expect(createSql).toHaveBeenCalledWith(validEnvironment.MIGRATION_DATABASE_URL);
    expect(query).toHaveBeenCalledOnce();
    const [strings, ...values] = query.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const statement = strings.join('');
    expect(statement).toMatch(/current_database\(\)[\s\S]*current_user/);
    expect(statement).toMatch(/statement_timestamp\(\)[\s\S]*count\(\*\)[\s\S]*FROM public\."user"/);
    expect(statement).toMatch(/to_regclass\('public\."EnrollmentCode"'\)/);
    expect(statement).toMatch(/to_regclass\('public\."EnrollmentClaim"'\)/);
    expect(values).toEqual([]);
  });

  it.each([
    { databaseName: 'unexpected', migrationRole: 'migration_role', preMigrationSchema: true, ...baseline },
    { databaseName: 'app', migrationRole: 'unexpected', preMigrationSchema: true, ...baseline },
    { databaseName: 'app', migrationRole: 'migration_role', preMigrationSchema: false, ...baseline },
    { databaseName: 'app', migrationRole: 'migration_role', preMigrationSchema: true, ...baseline, cutoverStartedAt: 'ambiguous' },
    { databaseName: 'app', migrationRole: 'migration_role', preMigrationSchema: true, ...baseline, cutoverStartedAt: '2026-02-31T08:30:00.123456Z' },
    { databaseName: 'app', migrationRole: 'migration_role', preMigrationSchema: true, ...baseline, baselineUserCount: '-1' },
  ])('rejects target drift or malformed baseline data: %o', async (row) => {
    const createSql = vi.fn(() => vi.fn(async () => ([row])));

    await expect(captureProductionCutoverBaseline({
      environment: validEnvironment,
      createSql,
    })).rejects.toThrow('Production cutover baseline capture failed.');
  });

  it('prints only the paired JSON baseline on success', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const createSql = vi.fn(() => vi.fn(async () => ([{
      databaseName: 'app',
      migrationRole: 'migration_role',
      preMigrationSchema: true,
      ...baseline,
    }])));

    await expect(runProductionCutoverBaselineCapture({
      environment: validEnvironment,
      createSql,
      log,
      error,
    })).resolves.toBe(0);

    expect(log).toHaveBeenCalledWith(JSON.stringify(baseline));
    expect(error).not.toHaveBeenCalled();
  });

  it('fails with one fixed message without echoing connection material', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const secretSentinel = 'DO_NOT_ECHO_BASELINE_CAPTURE_SECRET';

    await expect(runProductionCutoverBaselineCapture({
      environment: {
        ...validEnvironment,
        MIGRATION_DATABASE_URL: `postgresql://migration_role:${secretSentinel}@[invalid`,
      },
      log,
      error,
    })).resolves.toBe(1);

    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('Production cutover baseline capture failed.');
    expect(JSON.stringify(error.mock.calls)).not.toContain(secretSentinel);
  });
});
