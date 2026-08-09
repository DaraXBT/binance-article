import { getRuntimeDatabase } from '@/server/db/runtime';
import { createEnrollmentRepository } from '@/server/modules/enrollment/repository';

import { parseAuthEnvironment } from './auth-policy';
import { createBetterAuth } from './better-auth';
import { createInvitationEnrollmentGate } from './invitation-enrollment';

type RuntimeEnvironment = Record<string, string | undefined>;

let runtimeAuth: ReturnType<typeof createBetterAuth> | undefined;

export function createRuntimeAuth(environment: RuntimeEnvironment) {
  const authEnvironment = parseAuthEnvironment(environment);
  const database = getRuntimeDatabase(environment);
  const repository = createEnrollmentRepository(database);
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
