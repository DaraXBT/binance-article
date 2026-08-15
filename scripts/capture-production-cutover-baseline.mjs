import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { neon } from '@neondatabase/serverless';

import { validateProductionMigrationTarget } from './check-production-migration-target.mjs';

const FAILURE_MESSAGE = 'Production cutover baseline capture failed.';
const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})\d{3}Z$/;
const COUNT_PATTERN = /^(0|[1-9]\d*)$/;
const MAX_BIGINT = 9_223_372_036_854_775_807n;

/**
 * @param {unknown} value
 */
export function isProductionCutoverBaseline(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'baselineUserCount' || keys[1] !== 'cutoverStartedAt') {
    return false;
  }

  const { cutoverStartedAt, baselineUserCount } = value;
  const timestampMatch = typeof cutoverStartedAt === 'string'
    ? TIMESTAMP_PATTERN.exec(cutoverStartedAt)
    : null;
  const millisecondTimestamp = timestampMatch ? `${timestampMatch[1]}Z` : '';
  if (
    !timestampMatch ||
    Number.isNaN(Date.parse(millisecondTimestamp)) ||
    new Date(millisecondTimestamp).toISOString() !== millisecondTimestamp
  ) return false;
  if (
    typeof baselineUserCount !== 'string' ||
    !COUNT_PATTERN.test(baselineUserCount) ||
    baselineUserCount.length > 19 ||
    BigInt(baselineUserCount) > MAX_BIGINT
  ) return false;
  return true;
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
export async function captureProductionCutoverBaseline({
  environment = process.env,
  createSql = neon,
} = {}) {
  try {
    validateProductionMigrationTarget(environment);
    const sql = createSql(environment.MIGRATION_DATABASE_URL);
    const rows = await sql`
      SELECT current_database() AS "databaseName",
             current_user AS "migrationRole",
             to_char(
               statement_timestamp() AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
             ) AS "cutoverStartedAt",
             count(*)::text AS "baselineUserCount",
             to_regclass('public."EnrollmentCode"') IS NULL
               AND to_regclass('public."EnrollmentClaim"') IS NULL
               AS "preMigrationSchema"
      FROM public."user"
    `;
    const baseline = {
      cutoverStartedAt: rows?.[0]?.cutoverStartedAt,
      baselineUserCount: rows?.[0]?.baselineUserCount,
    };
    if (
      rows?.length !== 1 ||
      rows[0]?.databaseName !== environment.EXPECTED_PRODUCTION_DATABASE_NAME ||
      rows[0]?.migrationRole !== environment.EXPECTED_PRODUCTION_MIGRATION_ROLE ||
      rows[0]?.preMigrationSchema !== true ||
      !isProductionCutoverBaseline(baseline)
    ) throw new Error(FAILURE_MESSAGE);
    return baseline;
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
export async function runProductionCutoverBaselineCapture({
  environment = process.env,
  createSql = neon,
  log = console.log,
  error = console.error,
} = {}) {
  try {
    const baseline = await captureProductionCutoverBaseline({ environment, createSql });
    log(JSON.stringify(baseline));
    return 0;
  } catch {
    error(FAILURE_MESSAGE);
    return 1;
  }
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) process.exitCode = await runProductionCutoverBaselineCapture();
