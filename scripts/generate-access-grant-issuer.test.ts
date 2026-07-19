import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  assertOperatorDatabaseUrl,
  issueGenerationAccessGrant,
  runGenerationAccessGrantCli,
} from './generate-access-grant-issuer.mjs';

const OPERATOR_URL =
  'postgresql://grant_issuer:password@ep-example.neon.tech/app?sslmode=require';
const FIXED_NOW = new Date('2026-07-19T08:00:00.000Z');
const FIXED_RAW_CODE = `gac_${'ab'.repeat(18)}`;

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function deterministicRandomBytes(size: number) {
  expect(size).toBe(18);
  return Buffer.alloc(size, 0xab);
}

describe('generation access grant issuer', () => {
  it.each([
    undefined,
    '',
    'sqlite:./dev.db',
    'https://example.com/database',
    'postgresql://user:pass@ep-example.neon.tech/app',
  ])('rejects a missing, unsupported, or non-TLS operator URL: %s', (value) => {
    expect(() => assertOperatorDatabaseUrl(value)).toThrow();
  });

  it('allows explicit local PostgreSQL and TLS-protected remote PostgreSQL URLs', () => {
    expect(assertOperatorDatabaseUrl(OPERATOR_URL)).toBe(OPERATOR_URL);
    expect(assertOperatorDatabaseUrl('postgresql://postgres:postgres@localhost:5432/xarticle'))
      .toBe('postgresql://postgres:postgres@localhost:5432/xarticle');
  });

  it('persists only hashes and metadata with explicit IDs and timestamps', async () => {
    const query = vi.fn(async () => ([{
      id: 'grant-id',
      codePrefix: FIXED_RAW_CODE.slice(0, 12),
    }]));
    const createSql = vi.fn(() => query);

    await expect(issueGenerationAccessGrant({
      environment: {
        OPERATOR_DATABASE_URL: OPERATOR_URL,
        DATABASE_URL: 'postgresql://must:not@be-used.invalid/app',
        GENERATE_ACCESS_CODE: 'rotation-secret',
      },
      createSql,
      randomBytes: deterministicRandomBytes,
      randomUuid: () => 'grant-id',
      now: () => FIXED_NOW,
    })).resolves.toEqual({
      id: 'grant-id',
      rawCode: FIXED_RAW_CODE,
      codePrefix: FIXED_RAW_CODE.slice(0, 12),
    });

    expect(createSql).toHaveBeenCalledWith(OPERATOR_URL);
    expect(query).toHaveBeenCalledOnce();
    const [strings, ...values] = query.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const sql = strings.join('$value');
    expect(sql).toMatch(/INSERT INTO "GenerationAccessGrant"/);
    expect(sql).toMatch(/"id"[\s\S]*"codeHash"[\s\S]*"codePrefix"[\s\S]*"envCodeHash"/);
    expect(sql).toMatch(/'active'/);
    expect(sql).toMatch(/NULL/);
    expect(values).toEqual([
      'grant-id',
      sha256(FIXED_RAW_CODE),
      FIXED_RAW_CODE.slice(0, 12),
      sha256('rotation-secret'),
      FIXED_NOW,
      FIXED_NOW,
    ]);
    expect(values).not.toContain(FIXED_RAW_CODE);
    expect(values).not.toContain('rotation-secret');
  });

  it('sanitizes database failures and never returns the generated code after a failed insert', async () => {
    const query = vi.fn(async () => {
      throw new Error(`password=database-secret raw=${FIXED_RAW_CODE}`);
    });

    let caught: unknown;
    try {
      await issueGenerationAccessGrant({
        environment: {
          OPERATOR_DATABASE_URL: OPERATOR_URL,
          GENERATE_ACCESS_CODE: 'rotation-secret',
        },
        createSql: () => query,
        randomBytes: deterministicRandomBytes,
        randomUuid: () => 'grant-id',
        now: () => FIXED_NOW,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('Generation access grant could not be stored.');
    expect(JSON.stringify(caught)).not.toContain('database-secret');
    expect(JSON.stringify(caught)).not.toContain(FIXED_RAW_CODE);
  });

  it('prints the one-time code only after issuance succeeds', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const issue = vi.fn().mockResolvedValue({
      id: 'grant-id',
      rawCode: FIXED_RAW_CODE,
      codePrefix: FIXED_RAW_CODE.slice(0, 12),
    });

    await expect(runGenerationAccessGrantCli({ issue, log, error })).resolves.toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain(FIXED_RAW_CODE);
    expect(error).not.toHaveBeenCalled();
  });

  it('prints only a generic failure and no code or provider details', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const issue = vi.fn().mockRejectedValue(
      new Error(`password=database-secret raw=${FIXED_RAW_CODE}`)
    );

    await expect(runGenerationAccessGrantCli({ issue, log, error })).resolves.toBe(1);
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('Generation access grant could not be created.');
    expect(error.mock.calls.flat().join('\n')).not.toContain('database-secret');
    expect(error.mock.calls.flat().join('\n')).not.toContain(FIXED_RAW_CODE);
  });
});
