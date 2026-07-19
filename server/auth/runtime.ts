import { createDatabase } from '@/server/db/client';

import { parseAuthEnvironment } from './auth-policy';
import { createBetterAuth } from './better-auth';
import { createInvitationEnrollmentGate } from './invitation-enrollment';
import { createDrizzleInvitationRepository } from './invitation-repository';

type RuntimeEnvironment = Record<string, string | undefined>;

let runtimeAuth: ReturnType<typeof createBetterAuth> | undefined;

export function createRuntimeAuth(environment: RuntimeEnvironment) {
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  const authEnvironment = parseAuthEnvironment(environment);
  const database = createDatabase(databaseUrl);
  const repository = createDrizzleInvitationRepository(database);
  const enrollmentGate = createInvitationEnrollmentGate({ repository });

  return createBetterAuth({
    database,
    environment: authEnvironment,
    enrollmentGate,
  });
}

export function getRuntimeAuth(
  environment: RuntimeEnvironment = process.env,
): ReturnType<typeof createBetterAuth> {
  runtimeAuth ??= createRuntimeAuth(environment);
  return runtimeAuth;
}

export function resetRuntimeAuthForTests() {
  runtimeAuth = undefined;
}
