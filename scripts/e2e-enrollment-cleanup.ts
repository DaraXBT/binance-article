export type E2eEnrollmentCleanupSql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<unknown>;

type E2eEnrollmentCleanupEnvironment = Readonly<Record<string, string | undefined>>;

const E2E_OWNER_USER_ID = 'e2e_user';

export async function resetE2eEnrollmentState(input: {
  sql: E2eEnrollmentCleanupSql;
  environment?: E2eEnrollmentCleanupEnvironment;
}): Promise<void> {
  const environment = input.environment ?? process.env;
  if (
    environment.E2E_SEED_AUTH !== '1' ||
    environment.E2E_ENROLLMENT_MUTATIONS !== '1'
  ) {
    throw new Error('Enrollment E2E cleanup requires explicit disposable-database opt-in.');
  }

  // EnrollmentCode is a singleton across the installation, not per creator.
  // A previous interrupted run can leave rows whose creator was set to NULL,
  // so disposable E2E isolation must reset every shared-code row.
  await input.sql`
    DELETE FROM "EnrollmentClaim"
    WHERE "codeId" IS NOT NULL
  `;
  await input.sql`DELETE FROM "EnrollmentCode"`;
  await input.sql`
    DELETE FROM "RateLimitBucket"
    WHERE "key" = ${`owner-mutation:enrollment_code:${E2E_OWNER_USER_ID}`}
  `;
}
