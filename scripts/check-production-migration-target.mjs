import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { neon } from '@neondatabase/serverless';

const FAILURE_MESSAGE = 'Production migration target check failed.';
const ALLOWED_CONNECTION_PARAMETERS = new Set(['sslmode', 'channel_binding']);

function fail() {
  throw new Error(FAILURE_MESSAGE);
}

function isLocalDatabaseHost(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized.endsWith('.localhost');
}

/**
 * Compare only non-secret target identifiers. This function deliberately
 * returns no URL or parsed credential material and maps every failure to one
 * fixed message so malformed URLs cannot be echoed by Node's URL parser.
 * @param {Record<string, string | undefined>} [environment]
 */
export function validateProductionMigrationTarget(environment = process.env) {
  try {
    const databaseUrl = environment.MIGRATION_DATABASE_URL;
    const expectedAuthority = environment.EXPECTED_PRODUCTION_DATABASE_AUTHORITY;
    const expectedDatabase = environment.EXPECTED_PRODUCTION_DATABASE_NAME;
    const expectedRole = environment.EXPECTED_PRODUCTION_MIGRATION_ROLE;
    if (
      !databaseUrl || databaseUrl !== databaseUrl.trim() ||
      !expectedAuthority || expectedAuthority !== expectedAuthority.trim() ||
      !expectedDatabase || expectedDatabase !== expectedDatabase.trim() ||
      !expectedRole || expectedRole !== expectedRole.trim()
    ) fail();
    if (/[@/?#\s]/.test(expectedAuthority)) fail();

    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') fail();
    if (!parsed.hostname || !parsed.host || isLocalDatabaseHost(parsed.hostname)) fail();
    if (parsed.hash) fail();
    for (const parameter of parsed.searchParams.keys()) {
      if (!ALLOWED_CONNECTION_PARAMETERS.has(parameter)) fail();
    }
    if (parsed.searchParams.getAll('sslmode').length !== 1) fail();
    if (parsed.searchParams.get('sslmode') !== 'require') fail();
    const channelBinding = parsed.searchParams.getAll('channel_binding');
    if (channelBinding.length > 1) fail();
    if (channelBinding.length === 1 && channelBinding[0] !== 'require') fail();

    const database = decodeURIComponent(parsed.pathname.slice(1));
    const role = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    if (!database || database.includes('/') || !role || !password) fail();
    if (
      parsed.host !== expectedAuthority ||
      database !== expectedDatabase ||
      role !== expectedRole
    ) fail();
  } catch {
    throw new Error(FAILURE_MESSAGE);
  }
}

/**
 * @param {{
 *   environment?: Record<string, string | undefined>;
 *   createSql?: (databaseUrl: string) => (
 *     strings: TemplateStringsArray,
 *     ...values: unknown[]
 *   ) => Promise<Array<Record<string, unknown>>>;
 * }} [options]
 */
export async function verifyProductionMigrationTarget({
  environment = process.env,
  createSql = neon,
} = {}) {
  validateProductionMigrationTarget(environment);
  try {
    const sql = createSql(environment.MIGRATION_DATABASE_URL);
    const rows = await sql`
      SELECT current_database() AS "databaseName",
             current_user AS "migrationRole"
    `;
    if (
      rows?.length !== 1 ||
      rows[0]?.databaseName !== environment.EXPECTED_PRODUCTION_DATABASE_NAME ||
      rows[0]?.migrationRole !== environment.EXPECTED_PRODUCTION_MIGRATION_ROLE
    ) fail();
  } catch {
    throw new Error(FAILURE_MESSAGE);
  }
}

/**
 * @param {{
 *   environment?: Record<string, string | undefined>;
 *   createSql?: (databaseUrl: string) => (
 *     strings: TemplateStringsArray,
 *     ...values: unknown[]
 *   ) => Promise<Array<Record<string, unknown>>>;
 *   log?: (message: string) => void;
 *   error?: (message: string) => void;
 * }} [options]
 */
export async function runProductionMigrationTargetCheck({
  environment = process.env,
  createSql = neon,
  log = console.log,
  error = console.error,
} = {}) {
  try {
    await verifyProductionMigrationTarget({ environment, createSql });
    log('Production migration target and connected identity match.');
    return 0;
  } catch {
    error(FAILURE_MESSAGE);
    return 1;
  }
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) process.exitCode = await runProductionMigrationTargetCheck();
