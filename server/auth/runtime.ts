import { getRuntimeDatabase } from '@/server/db/runtime';

import { parseAuthEnvironment } from './auth-policy';
import { createBetterAuth } from './better-auth';
import { createInvitationEnrollmentGate } from './invitation-enrollment';
import { createDrizzleInvitationRepository } from './invitation-repository';

type RuntimeEnvironment = Record<string, string | undefined>;

let runtimeAuth: ReturnType<typeof createBetterAuth> | undefined;

export function createRuntimeAuth(environment: RuntimeEnvironment) {
  const authEnvironment = parseAuthEnvironment(environment);
  const database = getRuntimeDatabase(environment);
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
