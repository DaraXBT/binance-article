import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { neon } from '@neondatabase/serverless';

import { validateProductionMigrationTarget } from './check-production-migration-target.mjs';
import { isProductionCutoverBaseline } from './capture-production-cutover-baseline.mjs';

const FAILURE_MESSAGE = 'Production rollback readiness check failed.';
const DRAIN_INTERVAL_MS = 300_000;

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

/**
 * @param {Record<string, string | undefined>} [environment]
 */
export function parseProductionRollbackBaseline(environment = process.env) {
  try {
    const rawBaseline = environment.PRODUCTION_ROLLBACK_BASELINE;
    if (!rawBaseline || rawBaseline !== rawBaseline.trim()) throw new Error(FAILURE_MESSAGE);
    const baseline = JSON.parse(rawBaseline);
    if (!isProductionCutoverBaseline(baseline)) throw new Error(FAILURE_MESSAGE);
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
 *   waitForDrainInterval?: (milliseconds: number) => Promise<void>;
 * }} [options]
 */
export async function verifyProductionRollbackReadiness({
  environment = process.env,
  createSql = neon,
  waitForDrainInterval = wait,
} = {}) {
  try {
    validateProductionMigrationTarget(environment);
    const baseline = parseProductionRollbackBaseline(environment);
    const sql = createSql(environment.MIGRATION_DATABASE_URL);
    const checkCurrentState = async () => {
      const rows = await sql`
        WITH rollback_input AS (
          SELECT ${baseline.cutoverStartedAt}::timestamptz AS cutover_started_at,
                 ${baseline.baselineUserCount}::bigint AS baseline_user_count
        ),
        rollback_state AS (
          SELECT (SELECT count(*) FROM public."EnrollmentCode") AS code_rows,
                 (SELECT count(*) FROM public."EnrollmentClaim") AS claim_rows,
                 (SELECT count(*) FROM public."user"
                  WHERE "createdAt" >= rollback_input.cutover_started_at)
                   AS users_created_since_cutover,
                 (SELECT count(*) FROM public."user") AS current_user_count,
                 rollback_input.cutover_started_at,
                 rollback_input.baseline_user_count
          FROM rollback_input
        ),
        drain_state AS (
          SELECT (
                   SELECT count(*)
                   FROM pg_stat_activity
                   WHERE datname = current_database()
                     AND pid <> pg_backend_pid()
                     AND backend_type = 'client backend'
                     AND state IS DISTINCT FROM 'idle'
                 ) AS other_active_clients,
                 (
                   SELECT count(*)
                   FROM pg_locks locks
                   JOIN pg_stat_activity activity ON activity.pid = locks.pid
                   WHERE activity.datname = current_database()
                     AND locks.pid <> pg_backend_pid()
                     AND NOT locks.granted
                 ) AS waiting_locks,
                 (
                   SELECT count(*)
                   FROM pg_prepared_xacts
                   WHERE database = current_database()
                 ) AS prepared_transactions
        )
        SELECT current_database() AS "databaseName",
               current_user AS "migrationRole",
               drain_state.other_active_clients = 0
                 AND drain_state.waiting_locks = 0
                 AND drain_state.prepared_transactions = 0 AS "drainClear",
               rollback_state.code_rows = 0
                 AND rollback_state.claim_rows = 0
                 AND rollback_state.users_created_since_cutover = 0
                 AND rollback_state.current_user_count = rollback_state.baseline_user_count
                 AND rollback_state.cutover_started_at <= statement_timestamp()
                 AS "rollbackEligible"
        FROM rollback_state
        CROSS JOIN drain_state
      `;
      if (
        rows?.length !== 1 ||
        rows[0]?.databaseName !== environment.EXPECTED_PRODUCTION_DATABASE_NAME ||
        rows[0]?.migrationRole !== environment.EXPECTED_PRODUCTION_MIGRATION_ROLE ||
        rows[0]?.drainClear !== true ||
        rows[0]?.rollbackEligible !== true
      ) throw new Error(FAILURE_MESSAGE);
    };

    await checkCurrentState();
    await waitForDrainInterval(DRAIN_INTERVAL_MS);
    await checkCurrentState();
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
 *   waitForDrainInterval?: (milliseconds: number) => Promise<void>;
 *   log?: (message: string) => void;
 *   error?: (message: string) => void;
 * }} [options]
 */
export async function runProductionRollbackReadinessCheck({
  environment = process.env,
  createSql = neon,
  waitForDrainInterval = wait,
  log = console.log,
  error = console.error,
} = {}) {
  try {
    await verifyProductionRollbackReadiness({
      environment,
      createSql,
      waitForDrainInterval,
    });
    log('Production rollback target, drain, and eligibility match.');
    return 0;
  } catch {
    error(FAILURE_MESSAGE);
    return 1;
  }
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) process.exitCode = await runProductionRollbackReadinessCheck();
