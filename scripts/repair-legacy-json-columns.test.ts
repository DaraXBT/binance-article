import { describe, expect, it, vi } from 'vitest';

import {
  assertLegacyJsonRepairEnvironment,
  repairLegacyJsonColumns,
  runLegacyJsonRepairCli,
} from './repair-legacy-json-columns.mjs';

const REMOTE_URL =
  'postgresql://migration_operator:password@ep-example.neon.tech/app?sslmode=require';

function allowedEnvironment(databaseUrl = REMOTE_URL) {
  return {
    ALLOW_LEGACY_JSON_REPAIR: '1',
    CONFIRM_LEGACY_JSON_REPAIR_BACKUP: '1',
    MIGRATION_DATABASE_URL: databaseUrl,
  };
}

type QueryRecord = {
  strings: string[];
  values: unknown[];
};

function createDatabaseDouble({ failure }: { failure?: Error } = {}) {
  const transaction = vi.fn(async (queries: QueryRecord[]) => {
    if (failure) throw failure;
    return queries;
  });
  const sql = Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings: Array.from(strings),
      values,
    })),
    { transaction },
  );
  const createSql = vi.fn(() => sql);
  return { createSql, sql, transaction };
}

describe('legacy JSON column repair', () => {
  it('requires an explicit backup confirmation and a TLS-protected migration URL', () => {
    expect(() => assertLegacyJsonRepairEnvironment({})).toThrow(
      'ALLOW_LEGACY_JSON_REPAIR',
    );
    expect(() => assertLegacyJsonRepairEnvironment({
      ALLOW_LEGACY_JSON_REPAIR: '1',
      MIGRATION_DATABASE_URL: REMOTE_URL,
    })).toThrow('CONFIRM_LEGACY_JSON_REPAIR_BACKUP');
    expect(() => assertLegacyJsonRepairEnvironment(allowedEnvironment(
      'postgresql://operator:password@ep-example.neon.tech/app',
    ))).toThrow(/sslmode=require/);
    expect(assertLegacyJsonRepairEnvironment(allowedEnvironment())).toEqual({
      databaseUrl: REMOTE_URL,
    });
    expect(assertLegacyJsonRepairEnvironment(allowedEnvironment(
      'postgresql://postgres:postgres@localhost:5432/xarticle',
    ))).toEqual({
      databaseUrl: 'postgresql://postgres:postgres@localhost:5432/xarticle',
    });
  });

  it('validates and converts only the four reviewed columns in one transaction', async () => {
    const { createSql, transaction } = createDatabaseDouble();

    await expect(repairLegacyJsonColumns({
      environment: allowedEnvironment(),
      createSql,
    })).resolves.toEqual({ repaired: true });

    expect(createSql).toHaveBeenCalledWith(REMOTE_URL);
    expect(transaction).toHaveBeenCalledOnce();
    const [queries, options] = transaction.mock.calls[0] as unknown as [
      QueryRecord[],
      Record<string, unknown>,
    ];
    const sql = queries.map((query) => query.strings.join('$value')).join('\n');

    expect(options).toMatchObject({ isolationLevel: 'Serializable' });
    expect(sql).toMatch(/SET LOCAL lock_timeout/i);
    expect(sql).toMatch(/SET LOCAL statement_timeout/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toContain("to_regclass('drizzle.__drizzle_migrations')");
    for (const table of [
      'Workspace',
      'WorkspaceSession',
      'DeckProject',
      'Slide',
      'CaptionPackage',
      'JobRun',
      'RateLimitBucket',
      'RenderAsset',
      'GenerationAccessGrant',
    ]) {
      expect(sql).toContain(table);
    }
    for (const cloudTable of ['user', 'Invitation', 'WorkspaceMember', 'PublisherDevice']) {
      expect(sql).toContain(cloudTable);
    }
    expect(sql).toMatch(/information_schema\.columns/i);
    expect(sql).toMatch(/pg_input_is_valid/i);
    expect(sql).toMatch(/jsonb_typeof[\s\S]*array/i);
    expect(sql).toMatch(/jsonb_typeof[\s\S]*object/i);
    expect(sql).toMatch(
      /ALTER TABLE "Slide" ALTER COLUMN "bullets" TYPE jsonb USING "bullets"::jsonb/i,
    );
    expect(sql).toMatch(
      /ALTER TABLE "CaptionPackage" ALTER COLUMN "blogSections" TYPE jsonb USING "blogSections"::jsonb/i,
    );
    expect(sql).toMatch(
      /ALTER TABLE "CaptionPackage" ALTER COLUMN "blogTags" TYPE jsonb USING "blogTags"::jsonb/i,
    );
    expect(sql).toMatch(
      /ALTER TABLE "DeckProject" ALTER COLUMN "customTheme" TYPE jsonb USING "customTheme"::jsonb/i,
    );
    expect(sql).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|DELETE\s+FROM|TRUNCATE/i);
  });

  it('fails closed before connecting and sanitizes provider failures', async () => {
    const blocked = createDatabaseDouble();
    await expect(repairLegacyJsonColumns({
      environment: {},
      createSql: blocked.createSql,
    })).rejects.toThrow('ALLOW_LEGACY_JSON_REPAIR');
    expect(blocked.createSql).not.toHaveBeenCalled();

    const failed = createDatabaseDouble({
      failure: new Error('password=database-secret host=private-endpoint'),
    });
    let caught: unknown;
    try {
      await repairLegacyJsonColumns({
        environment: allowedEnvironment(),
        createSql: failed.createSql,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('Legacy JSON column repair failed.');
    expect(JSON.stringify(caught)).not.toContain('database-secret');
    expect(JSON.stringify(caught)).not.toContain('private-endpoint');
  });

  it('prints only generic CLI success or failure messages', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const repair = vi.fn().mockResolvedValue({ repaired: true });

    await expect(runLegacyJsonRepairCli({ repair, log, error })).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith('Legacy JSON columns repaired and verified.');
    expect(error).not.toHaveBeenCalled();

    repair.mockRejectedValueOnce(new Error('password=database-secret'));
    log.mockClear();
    await expect(runLegacyJsonRepairCli({ repair, log, error })).resolves.toBe(1);
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('Legacy JSON column repair failed.');
    expect(error.mock.calls.flat().join('\n')).not.toContain('database-secret');
  });
});
