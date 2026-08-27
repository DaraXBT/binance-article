import { describe, expect, it, vi } from 'vitest';

import {
  runProductionCutoverStateCheck,
  verifyProductionCutoverState,
} from './check-production-cutover-state.mjs';

const validEnvironment = {
  MIGRATION_DATABASE_URL:
    'postgresql://migration_role:synthetic-password@db.example.invalid:5432/app?sslmode=require',
  EXPECTED_PRODUCTION_DATABASE_AUTHORITY: 'db.example.invalid:5432',
  EXPECTED_PRODUCTION_DATABASE_NAME: 'app',
  EXPECTED_PRODUCTION_MIGRATION_ROLE: 'migration_role',
};

const passingRow = {
  databaseName: 'app',
  migrationRole: 'migration_role',
  ledgerMatches: true,
  unexpected0018Clear: true,
  commandsDrained: true,
  longTransactionsClear: true,
  waitingLocksClear: true,
  targetWaitingLocksClear: true,
  ownershipMatches: true,
  schemaPrivilegesMatch: true,
  publicationKindMatches: true,
  draftKindColumnMatches: true,
  commandKindColumnMatches: true,
  draftKindRowsMatch: true,
  commandKindRowsMatch: true,
  draftVersionDefaultMatches: true,
  draftVersionConstraintMatches: true,
  draftIndexesMatch: true,
  ciphertextConstraintMatches: true,
  moduloConstraintMatches: true,
  credentialRowsMatch: true,
};

const stageExpectations = [
  {
    stage: 'pre-0017',
    ledgerCount: 17,
    newestTimestamp: 1_786_272_216_466,
    newestHash: 'e51e2e81da136f49e10dbc39bee89ead439f3c5cf5b8f7f834a632667e1923c4',
    after0017: false,
    after0018: false,
  },
  {
    stage: 'post-0017-pre-0018',
    ledgerCount: 18,
    newestTimestamp: 1_786_817_069_209,
    newestHash: '0d940b5fed7d8b5bc8b5711ec795465e2eef9c2941c90a556141396f194c008c',
    after0017: true,
    after0018: false,
  },
  {
    stage: 'post-0018',
    ledgerCount: 19,
    newestTimestamp: 1_786_878_159_785,
    newestHash: '926a7de82961250a9b358437e596bed4585af222558ce2bfe639dbba172701b8',
    after0017: true,
    after0018: true,
  },
] as const;

describe('production cutover state check', () => {
  it.each(stageExpectations)(
    'accepts the exact $stage state through one read-only query',
    async ({ stage, ledgerCount, newestTimestamp, newestHash, after0017, after0018 }) => {
      const query = vi.fn(async () => ([passingRow]));
      const createSql = vi.fn(() => query);

      await expect(verifyProductionCutoverState({
        stage,
        environment: validEnvironment,
        createSql,
      })).resolves.toBeUndefined();

      expect(createSql).toHaveBeenCalledWith(validEnvironment.MIGRATION_DATABASE_URL);
      expect(query).toHaveBeenCalledOnce();
      const [strings, ...values] = query.mock.calls[0] as unknown as [
        TemplateStringsArray,
        ...unknown[],
      ];
      const statement = strings.join('');

      expect(statement.trimStart()).toMatch(/^WITH\b/);
      expect(statement).not.toContain(';');
      expect(statement).not.toMatch(
        /\b(?:INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+(?:TABLE|TYPE|INDEX)|CREATE\s+(?:TABLE|TYPE|INDEX)|TRUNCATE)\b/i,
      );
      expect(statement).toMatch(/drizzle\.__drizzle_migrations/);
      expect(statement).toMatch(/count\(\*\)[\s\S]*created_at[\s\S]*hash/);
      expect(statement).toMatch(/pg_stat_activity[\s\S]*xact_start[\s\S]*interval '30 seconds'/);
      expect(statement).toMatch(
        /pg_has_role\(current_user,\s*'pg_read_all_stats',\s*'USAGE'\)/,
      );
      expect(statement).toMatch(/pg_prepared_xacts[\s\S]*prepared_transaction_count/);
      expect(statement).toMatch(/pg_locks[\s\S]*NOT locks\.granted/);
      expect(statement).toMatch(/PublicationDraft[\s\S]*PublisherCommand[\s\S]*WorkspaceAiCredential/);
      expect(statement).toMatch(/has_schema_privilege[\s\S]*'public'[\s\S]*'USAGE'/);
      expect(statement).toMatch(/has_schema_privilege[\s\S]*'public'[\s\S]*'CREATE'/);
      expect(statement).toMatch(/has_database_privilege[\s\S]*'CREATE'/);
      expect(statement).toMatch(/has_schema_privilege[\s\S]*'drizzle'[\s\S]*'USAGE'/);
      expect(statement).toMatch(/has_schema_privilege[\s\S]*'drizzle'[\s\S]*'CREATE'/);
      expect(statement).toMatch(/has_table_privilege[\s\S]*__drizzle_migrations[\s\S]*'SELECT'/);
      expect(statement).toMatch(/has_table_privilege[\s\S]*__drizzle_migrations[\s\S]*'INSERT'/);
      expect(statement).toMatch(/has_sequence_privilege[\s\S]*__drizzle_migrations_id_seq/);
      expect(statement).toMatch(/relowner[\s\S]*typowner/);
      expect(statement).toContain('pg_enum');
      expect(statement).toMatch(/enumlabel[\s\S]*enumsortorder/);
      expect(statement).toContain('pg_attribute');
      expect(statement).toContain('attnotnull');
      expect(statement).toMatch(/to_jsonb\([^)]+\)[\s\S]*kind/);
      expect(statement).toContain('pg_attrdef');
      expect(statement).toContain('pg_get_expr');
      expect(statement).toContain('pg_constraint');
      expect(statement).toContain('pg_get_constraintdef');
      expect(statement).toContain('pg_index');
      expect(statement).toContain('indisunique');
      expect(statement).toContain('indisvalid');
      expect(statement).toContain('indisready');
      expect(statement).toContain('PublicationDraft_workspaceId_articleId_target_key');
      expect(statement).toContain('PublicationDraft_workspaceId_articleId_target_kind_key');
      expect(statement).toMatch(/state::text NOT IN[\s\S]*'succeeded'[\s\S]*'outcome_unknown'/);
      expect(statement).toMatch(/command\.state IS NULL[\s\S]*state::text NOT IN/);
      expect(statement).toContain("^[A-Za-z0-9_-]+$");
      expect(statement).toContain(
        'char_length(ciphertext)>=24ANDchar_length(ciphertext)<=2048',
      );
      expect(statement).toMatch(/char_length\([^)]+\) NOT BETWEEN 24 AND 2048/);
      expect(statement).toMatch(/char_length\([^)]+\) % 4/);
      expect(statement).toMatch(/credential\.ciphertext IS NULL[\s\S]*ciphertext !~/);
      expect(statement).toContain('CHECK((char_length(ciphertext)%4)<>1)');
      expect(values).toEqual(expect.arrayContaining([
        ledgerCount,
        newestTimestamp,
        newestHash,
        after0017,
        after0018,
        'fbffebbaab6702061625a4c6274b8d16e676f677a582fc8fb931a2b53a13826a',
      ]));
    },
  );

  it.each(
    Object.keys(passingRow).filter((key) => !['databaseName', 'migrationRole'].includes(key)),
  )('fails closed when %s is false', async (field) => {
    const createSql = vi.fn(() => vi.fn(async () => ([{
      ...passingRow,
      [field]: false,
    }])));

    await expect(verifyProductionCutoverState({
      stage: 'post-0018',
      environment: validEnvironment,
      createSql,
    })).rejects.toThrow('Production cutover state check failed.');
  });

  it.each([
    { rows: [{ ...passingRow, databaseName: 'unexpected' }] },
    { rows: [{ ...passingRow, migrationRole: 'unexpected' }] },
    { rows: [] },
    { rows: [passingRow, passingRow] },
  ])('fails closed for an identity or result-cardinality mismatch', async ({ rows }) => {
    const createSql = vi.fn(() => vi.fn(async () => rows));

    await expect(verifyProductionCutoverState({
      stage: 'post-0018',
      environment: validEnvironment,
      createSql,
    })).rejects.toThrow('Production cutover state check failed.');
  });

  it.each([
    { args: [] },
    { args: ['unknown-stage'] },
    { args: ['pre-0017', 'extra'] },
  ])('rejects missing, unknown, or extra CLI stage arguments before connecting: $args', async ({ args }) => {
    const createSql = vi.fn();
    const log = vi.fn();
    const error = vi.fn();

    await expect(runProductionCutoverStateCheck({
      args,
      environment: validEnvironment,
      createSql,
      log,
      error,
    })).resolves.toBe(1);

    expect(createSql).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('Production cutover state check failed.');
  });

  it('rejects an invalid programmatic stage before connecting', async () => {
    const createSql = vi.fn();

    await expect(verifyProductionCutoverState({
      stage: 'unknown-stage',
      environment: validEnvironment,
      createSql,
    })).rejects.toThrow('Production cutover state check failed.');

    expect(createSql).not.toHaveBeenCalled();
  });

  it('uses fixed messages and never logs secret-bearing errors', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const secretSentinel = 'DO_NOT_ECHO_CUTOVER_SECRET';
    const createSql = vi.fn(() => vi.fn(async () => {
      throw new Error(`database refused ${secretSentinel}`);
    }));

    await expect(runProductionCutoverStateCheck({
      args: ['post-0018'],
      environment: {
        ...validEnvironment,
        MIGRATION_DATABASE_URL:
          `postgresql://migration_role:${secretSentinel}@db.example.invalid:5432/app?sslmode=require`,
      },
      createSql,
      log,
      error,
    })).resolves.toBe(1);

    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('Production cutover state check failed.');
    expect(JSON.stringify(error.mock.calls)).not.toContain(secretSentinel);
  });

  it('prints only the fixed success message for a valid stage', async () => {
    const log = vi.fn();
    const error = vi.fn();

    await expect(runProductionCutoverStateCheck({
      args: ['post-0018'],
      environment: validEnvironment,
      createSql: vi.fn(() => vi.fn(async () => ([passingRow]))),
      log,
      error,
    })).resolves.toBe(0);

    expect(log).toHaveBeenCalledWith('Production cutover state matches the requested stage.');
    expect(error).not.toHaveBeenCalled();
  });
});
