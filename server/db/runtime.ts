import { createDatabase } from './client';

type RuntimeEnvironment = Record<string, string | undefined>;

let runtimeDatabase: ReturnType<typeof createDatabase> | undefined;

export function getRuntimeDatabase(
  environment: RuntimeEnvironment = process.env,
): ReturnType<typeof createDatabase> {
  if (runtimeDatabase) return runtimeDatabase;
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  runtimeDatabase = createDatabase(databaseUrl);
  return runtimeDatabase;
}

export function resetRuntimeDatabaseForTests() {
  runtimeDatabase = undefined;
}
