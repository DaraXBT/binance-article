import { describe, expect, it } from 'vitest';

import { resetE2eEnrollmentState } from './e2e-enrollment-cleanup';

type CapturedQuery = {
  text: string;
  values: unknown[];
};

function queryHarness() {
  const queries: CapturedQuery[] = [];
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join('?'), values });
    return [];
  };
  return { queries, sql };
}

function compactSql(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

describe('disposable E2E enrollment cleanup', () => {
  it.each([
    {},
    { E2E_SEED_AUTH: '1' },
    { E2E_ENROLLMENT_MUTATIONS: '1' },
    { E2E_SEED_AUTH: 'true', E2E_ENROLLMENT_MUTATIONS: '1' },
    { E2E_SEED_AUTH: '1', E2E_ENROLLMENT_MUTATIONS: 'true' },
  ])('fails closed without both exact opt-ins: %o', async (environment) => {
    const harness = queryHarness();

    await expect(resetE2eEnrollmentState({
      environment,
      sql: harness.sql,
    })).rejects.toThrow(
      'Enrollment E2E cleanup requires explicit disposable-database opt-in.',
    );
    expect(harness.queries).toEqual([]);
  });

  it('clears every shared-code row before codes and the deterministic rate bucket', async () => {
    const harness = queryHarness();

    await resetE2eEnrollmentState({
      environment: {
        E2E_SEED_AUTH: '1',
        E2E_ENROLLMENT_MUTATIONS: '1',
      },
      sql: harness.sql,
    });

    expect(harness.queries).toHaveLength(3);
    expect(compactSql(harness.queries[0]?.text ?? '')).toBe(
      'DELETE FROM "EnrollmentClaim" WHERE "codeId" IS NOT NULL',
    );
    expect(compactSql(harness.queries[1]?.text ?? '')).toBe(
      'DELETE FROM "EnrollmentCode"',
    );
    expect(compactSql(harness.queries[2]?.text ?? '')).toBe(
      'DELETE FROM "RateLimitBucket" WHERE "key" = ?',
    );
    expect(harness.queries[2]?.values).toEqual([
      'owner-mutation:enrollment_code:e2e_user',
    ]);
    expect(harness.queries.map((query) => query.text).join('\n')).not.toContain(
      'createdByUserId',
    );
  });
});
