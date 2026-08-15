import { describe, expect, it, vi } from 'vitest';

import {
  parseProductionRollbackBaseline,
  runProductionRollbackReadinessCheck,
  verifyProductionRollbackReadiness,
} from './check-production-rollback-readiness.mjs';

const baseline = {
  cutoverStartedAt: '2026-08-15T08:30:00.123456Z',
  baselineUserCount: '7',
};

const validEnvironment = {
  MIGRATION_DATABASE_URL:
    'postgresql://migration_role:synthetic-password@db.example.invalid:5432/app?sslmode=require',
  EXPECTED_PRODUCTION_DATABASE_AUTHORITY: 'db.example.invalid:5432',
  EXPECTED_PRODUCTION_DATABASE_NAME: 'app',
  EXPECTED_PRODUCTION_MIGRATION_ROLE: 'migration_role',
  PRODUCTION_ROLLBACK_BASELINE: JSON.stringify(baseline),
};

describe('production rollback readiness check', () => {
  it('accepts only one exact timestamp/count baseline pair', () => {
    expect(parseProductionRollbackBaseline(validEnvironment)).toEqual(baseline);
  });

  it.each([
    undefined,
    '',
    ' {"cutoverStartedAt":"2026-08-15T08:30:00.123456Z","baselineUserCount":"7"}',
    '{"cutoverStartedAt":"ambiguous","baselineUserCount":"7"}',
    '{"cutoverStartedAt":"2026-02-31T08:30:00.123456Z","baselineUserCount":"7"}',
    '{"cutoverStartedAt":"2026-08-15T08:30:00.123456Z","baselineUserCount":7}',
    '{"cutoverStartedAt":"2026-08-15T08:30:00.123456Z","baselineUserCount":"-1"}',
    '{"cutoverStartedAt":"2026-08-15T08:30:00.123456Z","baselineUserCount":"7","extra":true}',
  ])('rejects a malformed or unpaired baseline: %s', (rawBaseline) => {
    expect(() => parseProductionRollbackBaseline({
      ...validEnvironment,
      PRODUCTION_ROLLBACK_BASELINE: rawBaseline,
    })).toThrow('Production rollback readiness check failed.');
  });

  it('checks connected identity, database drain, and eligibility in one parameterized query', async () => {
    const query = vi.fn(async () => ([{
      databaseName: 'app',
      migrationRole: 'migration_role',
      drainClear: true,
      rollbackEligible: true,
    }]));
    const createSql = vi.fn(() => query);
    const waitForDrainInterval = vi.fn(async () => {});

    await expect(verifyProductionRollbackReadiness({
      environment: validEnvironment,
      createSql,
      waitForDrainInterval,
    })).resolves.toBeUndefined();

    expect(createSql).toHaveBeenCalledWith(validEnvironment.MIGRATION_DATABASE_URL);
    expect(query).toHaveBeenCalledTimes(2);
    expect(waitForDrainInterval).toHaveBeenCalledWith(300_000);
    const [strings, ...values] = query.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const statement = strings.join('');
    expect(statement).toMatch(/current_database\(\)[\s\S]*current_user/);
    expect(statement).toMatch(/public\."EnrollmentCode"[\s\S]*public\."EnrollmentClaim"/);
    expect(statement).toMatch(/public\."user"[\s\S]*"createdAt"/);
    expect(statement).toMatch(/pg_stat_activity[\s\S]*pg_locks[\s\S]*pg_prepared_xacts/);
    expect(statement).toMatch(/backend_type = 'client backend'/);
    expect(statement).toMatch(/state IS DISTINCT FROM 'idle'/);
    expect(statement).toMatch(/statement_timestamp\(\)/);
    expect(values).toEqual([baseline.cutoverStartedAt, baseline.baselineUserCount]);
    expect(query.mock.calls[1]).toEqual(query.mock.calls[0]);
  });

  it.each([
    { databaseName: 'unexpected', migrationRole: 'migration_role', drainClear: true, rollbackEligible: true },
    { databaseName: 'app', migrationRole: 'unexpected', drainClear: true, rollbackEligible: true },
    { databaseName: 'app', migrationRole: 'migration_role', drainClear: false, rollbackEligible: true },
    { databaseName: 'app', migrationRole: 'migration_role', drainClear: true, rollbackEligible: false },
  ])('fails closed for identity, drain, or eligibility mismatch: %o', async (row) => {
    const createSql = vi.fn(() => vi.fn(async () => ([row])));

    await expect(verifyProductionRollbackReadiness({
      environment: validEnvironment,
      createSql,
    })).rejects.toThrow('Production rollback readiness check failed.');
  });

  it('fails closed when state changes during the enforced drain interval', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{
        databaseName: 'app',
        migrationRole: 'migration_role',
        drainClear: true,
        rollbackEligible: true,
      }])
      .mockResolvedValueOnce([{
        databaseName: 'app',
        migrationRole: 'migration_role',
        drainClear: true,
        rollbackEligible: false,
      }]);
    const waitForDrainInterval = vi.fn(async () => {});

    await expect(verifyProductionRollbackReadiness({
      environment: validEnvironment,
      createSql: vi.fn(() => query),
      waitForDrainInterval,
    })).rejects.toThrow('Production rollback readiness check failed.');

    expect(query).toHaveBeenCalledTimes(2);
    expect(waitForDrainInterval).toHaveBeenCalledWith(300_000);
  });

  it('uses fixed success and failure messages without printing private state', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const successSql = vi.fn(() => vi.fn(async () => ([{
      databaseName: 'app',
      migrationRole: 'migration_role',
      drainClear: true,
      rollbackEligible: true,
    }])));

    await expect(runProductionRollbackReadinessCheck({
      environment: validEnvironment,
      createSql: successSql,
      waitForDrainInterval: vi.fn(async () => {}),
      log,
      error,
    })).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith('Production rollback target, drain, and eligibility match.');
    expect(error).not.toHaveBeenCalled();

    log.mockClear();
    const failureSql = vi.fn(() => vi.fn(async () => ([{
      databaseName: 'app',
      migrationRole: 'migration_role',
      drainClear: false,
      rollbackEligible: true,
    }])));
    await expect(runProductionRollbackReadinessCheck({
      environment: validEnvironment,
      createSql: failureSql,
      log,
      error,
    })).resolves.toBe(1);
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('Production rollback readiness check failed.');
    expect(JSON.stringify(error.mock.calls)).not.toContain(baseline.cutoverStartedAt);
    expect(JSON.stringify(error.mock.calls)).not.toContain(baseline.baselineUserCount);
  });
});
