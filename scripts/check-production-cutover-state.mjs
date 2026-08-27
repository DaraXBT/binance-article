import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { neon } from '@neondatabase/serverless';

import { validateProductionMigrationTarget } from './check-production-migration-target.mjs';

const FAILURE_MESSAGE = 'Production cutover state check failed.';
const SUCCESS_MESSAGE = 'Production cutover state matches the requested stage.';
const FINAL_0018_HASH = '926a7de82961250a9b358437e596bed4585af222558ce2bfe639dbba172701b8';
const SUPERSEDED_0018_HASH = 'fbffebbaab6702061625a4c6274b8d16e676f677a582fc8fb931a2b53a13826a';
const TIMESTAMP_0018 = 1_786_878_159_785;

const STAGES = Object.freeze({
  'pre-0017': Object.freeze({
    ledgerCount: 17,
    newestTimestamp: 1_786_272_216_466,
    newestHash: 'e51e2e81da136f49e10dbc39bee89ead439f3c5cf5b8f7f834a632667e1923c4',
    after0017: false,
    after0018: false,
  }),
  'post-0017-pre-0018': Object.freeze({
    ledgerCount: 18,
    newestTimestamp: 1_786_817_069_209,
    newestHash: '0d940b5fed7d8b5bc8b5711ec795465e2eef9c2941c90a556141396f194c008c',
    after0017: true,
    after0018: false,
  }),
  'post-0018': Object.freeze({
    ledgerCount: 19,
    newestTimestamp: TIMESTAMP_0018,
    newestHash: FINAL_0018_HASH,
    after0017: true,
    after0018: true,
  }),
});

const REQUIRED_CHECK_FIELDS = Object.freeze([
  'ledgerMatches',
  'unexpected0018Clear',
  'commandsDrained',
  'longTransactionsClear',
  'waitingLocksClear',
  'targetWaitingLocksClear',
  'ownershipMatches',
  'schemaPrivilegesMatch',
  'publicationKindMatches',
  'draftKindColumnMatches',
  'commandKindColumnMatches',
  'draftKindRowsMatch',
  'commandKindRowsMatch',
  'draftVersionDefaultMatches',
  'draftVersionConstraintMatches',
  'draftIndexesMatch',
  'ciphertextConstraintMatches',
  'moduloConstraintMatches',
  'credentialRowsMatch',
]);

function fail() {
  throw new Error(FAILURE_MESSAGE);
}

function getStageExpectation(stage) {
  if (typeof stage !== 'string' || !Object.hasOwn(STAGES, stage)) fail();
  return STAGES[stage];
}

/**
 * Verify one exact production cutover checkpoint using a single read-only SQL
 * statement. All database values stay private; callers receive only success or
 * one fixed failure message.
 *
 * @param {{
 *   stage: string;
 *   environment?: Record<string, string | undefined>;
 *   createSql?: (databaseUrl: string) => (
 *     strings: TemplateStringsArray,
 *     ...values: unknown[]
 *   ) => Promise<Array<Record<string, unknown>>>;
 * }} options
 */
export async function verifyProductionCutoverState({
  stage,
  environment = process.env,
  createSql = neon,
} = {}) {
  try {
    const expected = getStageExpectation(stage);
    validateProductionMigrationTarget(environment);
    const sql = createSql(environment.MIGRATION_DATABASE_URL);
    const rows = await sql`
      WITH expected AS (
        SELECT ${expected.ledgerCount}::bigint AS ledger_count,
               ${expected.newestTimestamp}::bigint AS newest_timestamp,
               ${expected.newestHash}::text AS newest_hash,
               ${expected.after0017}::boolean AS after_0017,
               ${expected.after0018}::boolean AS after_0018,
               ${TIMESTAMP_0018}::bigint AS timestamp_0018,
               ${FINAL_0018_HASH}::text AS final_0018_hash,
               ${SUPERSEDED_0018_HASH}::text AS superseded_0018_hash
      ),
      ledger_state AS (
        SELECT count(*)::bigint AS applied_count,
               (
                 SELECT migration.created_at
                 FROM drizzle.__drizzle_migrations migration
                 ORDER BY migration.created_at DESC
                 LIMIT 1
               ) AS newest_timestamp,
               (
                 SELECT migration.hash
                 FROM drizzle.__drizzle_migrations migration
                 ORDER BY migration.created_at DESC
                 LIMIT 1
               ) AS newest_hash,
               count(*) FILTER (
                 WHERE migration.created_at = expected.timestamp_0018
               )::bigint AS timestamp_0018_count,
               count(*) FILTER (
                 WHERE migration.hash = expected.final_0018_hash
               )::bigint AS final_0018_hash_count,
               count(*) FILTER (
                 WHERE migration.created_at = expected.timestamp_0018
                   AND migration.hash = expected.final_0018_hash
               )::bigint AS final_0018_pair_count,
               count(*) FILTER (
                 WHERE migration.hash = expected.superseded_0018_hash
               )::bigint AS superseded_0018_hash_count
        FROM drizzle.__drizzle_migrations migration
        CROSS JOIN expected
      ),
      command_drain AS (
        SELECT count(*) FILTER (
                 WHERE command.state IS NULL
                    OR command.state::text NOT IN (
                   'succeeded',
                   'failed',
                   'cancelled',
                   'expired',
                   'outcome_unknown'
                 )
               )::bigint AS nonterminal_count
        FROM public."PublisherCommand" command
      ),
      transaction_state AS (
        SELECT (
                 SELECT count(*)
                 FROM pg_stat_activity activity
                 WHERE activity.datname = current_database()
                   AND activity.pid <> pg_backend_pid()
                   AND activity.xact_start IS NOT NULL
                   AND statement_timestamp() - activity.xact_start > interval '30 seconds'
               )::bigint AS long_transaction_count,
               (
                 SELECT count(*)
                 FROM pg_prepared_xacts prepared
                 WHERE prepared.database = current_database()
               )::bigint AS prepared_transaction_count
      ),
      statistics_visibility AS (
        SELECT role.rolsuper
                 OR pg_has_role(current_user, 'pg_read_all_stats', 'USAGE')
                 AS can_inspect_other_transactions
        FROM pg_roles role
        WHERE role.rolname = current_user
      ),
      lock_state AS (
        SELECT count(*)::bigint AS waiting_lock_count,
               count(*) FILTER (
                 WHERE locks.relation IN (
                   to_regclass('public."PublicationDraft"'),
                   to_regclass('public."PublisherCommand"'),
                   to_regclass('public."WorkspaceAiCredential"')
                 )
               )::bigint AS target_waiting_lock_count
        FROM pg_locks locks
        JOIN pg_stat_activity activity ON activity.pid = locks.pid
        WHERE activity.datname = current_database()
          AND locks.pid <> pg_backend_pid()
          AND NOT locks.granted
      ),
      relation_ownership AS (
        SELECT count(*)::integer AS relation_count,
               count(*) FILTER (
                 WHERE current_user = pg_get_userbyid(relation.relowner)
               )::integer AS owned_relation_count
        FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind IN ('r', 'p')
          AND relation.relname IN (
            'PublicationDraft',
            'PublisherCommand',
            'WorkspaceAiCredential'
          )
      ),
      publication_kind AS (
        SELECT count(DISTINCT data_type.oid)::integer AS type_count,
               coalesce(
                 array_agg(enum_value.enumlabel::text ORDER BY enum_value.enumsortorder)
                   FILTER (WHERE enum_value.oid IS NOT NULL),
                 ARRAY[]::text[]
               ) AS labels,
               count(DISTINCT data_type.oid) FILTER (
                 WHERE current_user = pg_get_userbyid(data_type.typowner)
               )::integer AS owned_type_count
        FROM pg_type data_type
        JOIN pg_namespace namespace ON namespace.oid = data_type.typnamespace
        LEFT JOIN pg_enum enum_value ON enum_value.enumtypid = data_type.oid
        WHERE namespace.nspname = 'public'
          AND data_type.typname = 'PublicationKind'
      ),
      kind_columns AS (
        SELECT count(*) FILTER (
                 WHERE relation.relname = 'PublicationDraft'
               )::integer AS draft_column_count,
               count(*) FILTER (
                 WHERE relation.relname = 'PublicationDraft'
                   AND attribute.attnotnull
                   AND type_namespace.nspname = 'public'
                   AND data_type.typname = 'PublicationKind'
               )::integer AS exact_draft_column_count,
               count(*) FILTER (
                 WHERE relation.relname = 'PublisherCommand'
               )::integer AS command_column_count,
               count(*) FILTER (
                 WHERE relation.relname = 'PublisherCommand'
                   AND attribute.attnotnull
                   AND type_namespace.nspname = 'public'
                   AND data_type.typname = 'PublicationKind'
               )::integer AS exact_command_column_count
        FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
        JOIN pg_type data_type ON data_type.oid = attribute.atttypid
        JOIN pg_namespace type_namespace ON type_namespace.oid = data_type.typnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind IN ('r', 'p')
          AND relation.relname IN ('PublicationDraft', 'PublisherCommand')
          AND attribute.attname = 'kind'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      ),
      kind_rows AS (
        SELECT (
                 SELECT count(*)
                 FROM public."PublicationDraft" draft
                 WHERE to_jsonb(draft) ? 'kind'
                   AND to_jsonb(draft) ->> 'kind' IS NULL
               )::bigint AS draft_null_count,
               (
                 SELECT count(*)
                 FROM public."PublisherCommand" command
                 WHERE to_jsonb(command) ? 'kind'
                   AND to_jsonb(command) ->> 'kind' IS NULL
               )::bigint AS command_null_count
      ),
      version_default AS (
        SELECT count(*)::integer AS definition_count,
               min(
                 regexp_replace(
                   pg_get_expr(attribute_default.adbin, attribute_default.adrelid),
                   '[[:space:]"]',
                   '',
                   'g'
                 )
               ) AS expression
        FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
        JOIN pg_attrdef attribute_default
          ON attribute_default.adrelid = relation.oid
         AND attribute_default.adnum = attribute.attnum
        WHERE namespace.nspname = 'public'
          AND relation.relname = 'PublicationDraft'
          AND relation.relkind IN ('r', 'p')
          AND attribute.attname = 'version'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      ),
      version_constraint AS (
        SELECT count(*)::integer AS constraint_count,
               count(*) FILTER (WHERE table_constraint.convalidated)::integer
                 AS validated_constraint_count,
               min(
                 regexp_replace(
                   pg_get_constraintdef(table_constraint.oid, true),
                   '[[:space:]"]',
                   '',
                   'g'
                 )
               ) AS definition
        FROM pg_constraint table_constraint
        JOIN pg_class relation ON relation.oid = table_constraint.conrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname = 'PublicationDraft'
          AND table_constraint.conname = 'PublicationDraft_version_check'
          AND table_constraint.contype = 'c'
      ),
      draft_indexes AS (
        SELECT index_relation.relname AS index_name,
               table_index.indisunique,
               table_index.indisvalid,
               table_index.indisready,
               table_index.indpred IS NULL AS predicate_free,
               table_index.indexprs IS NULL AS expression_free,
               array_agg(attribute.attname::text ORDER BY index_key.ordinality)
                 FILTER (WHERE index_key.ordinality <= table_index.indnkeyatts)
                 AS key_columns
        FROM pg_index table_index
        JOIN pg_class table_relation ON table_relation.oid = table_index.indrelid
        JOIN pg_namespace namespace ON namespace.oid = table_relation.relnamespace
        JOIN pg_class index_relation ON index_relation.oid = table_index.indexrelid
        CROSS JOIN LATERAL unnest(table_index.indkey)
          WITH ORDINALITY AS index_key(attnum, ordinality)
        JOIN pg_attribute attribute
          ON attribute.attrelid = table_relation.oid
         AND attribute.attnum = index_key.attnum
        WHERE namespace.nspname = 'public'
          AND table_relation.relname = 'PublicationDraft'
        GROUP BY index_relation.relname,
                 table_index.indisunique,
                 table_index.indisvalid,
                 table_index.indisready,
                 table_index.indpred,
                 table_index.indexprs
      ),
      draft_index_state AS (
        SELECT count(*) FILTER (
                 WHERE index_name = 'PublicationDraft_workspaceId_articleId_target_key'
               )::integer AS old_index_count,
               count(*) FILTER (
                 WHERE index_name = 'PublicationDraft_workspaceId_articleId_target_key'
                   AND indisunique
                   AND indisvalid
                   AND indisready
                   AND predicate_free
                   AND expression_free
                   AND key_columns = ARRAY['workspaceId', 'articleId', 'target']::text[]
               )::integer AS exact_old_index_count,
               count(*) FILTER (
                 WHERE indisunique
                   AND indisvalid
                   AND indisready
                   AND predicate_free
                   AND expression_free
                   AND key_columns = ARRAY['workspaceId', 'articleId', 'target']::text[]
               )::integer AS target_only_index_count,
               count(*) FILTER (
                 WHERE index_name = 'PublicationDraft_workspaceId_articleId_target_kind_key'
               )::integer AS new_index_count,
               count(*) FILTER (
                 WHERE index_name = 'PublicationDraft_workspaceId_articleId_target_kind_key'
                   AND indisunique
                   AND indisvalid
                   AND indisready
                   AND predicate_free
                   AND expression_free
                   AND key_columns = ARRAY['workspaceId', 'articleId', 'target', 'kind']::text[]
               )::integer AS exact_new_index_count,
               count(*) FILTER (
                 WHERE indisunique
                   AND indisvalid
                   AND indisready
                   AND predicate_free
                   AND expression_free
                   AND key_columns = ARRAY['workspaceId', 'articleId', 'target', 'kind']::text[]
               )::integer AS target_kind_index_count
        FROM draft_indexes
      ),
      credential_constraints AS (
        SELECT table_constraint.conname,
               table_constraint.convalidated,
               regexp_replace(
                 pg_get_constraintdef(table_constraint.oid, true),
                 '[[:space:]"]',
                 '',
                 'g'
               ) AS definition
        FROM pg_constraint table_constraint
        JOIN pg_class relation ON relation.oid = table_constraint.conrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname = 'WorkspaceAiCredential'
          AND table_constraint.contype = 'c'
          AND table_constraint.conname IN (
            'WorkspaceAiCredential_ciphertext_base64url_check',
            'WorkspaceAiCredential_ciphertext_base64url_length_check'
          )
      ),
      credential_constraint_state AS (
        SELECT count(*) FILTER (
                 WHERE conname = 'WorkspaceAiCredential_ciphertext_base64url_check'
               )::integer AS ciphertext_constraint_count,
               count(*) FILTER (
                 WHERE conname = 'WorkspaceAiCredential_ciphertext_base64url_check'
                   AND convalidated
                   AND definition =
                     'CHECK(ciphertext~''^[A-Za-z0-9_-]+$''::textANDchar_length(ciphertext)>=24ANDchar_length(ciphertext)<=2048)'
               )::integer AS repaired_ciphertext_constraint_count,
               count(*) FILTER (
                 WHERE conname = 'WorkspaceAiCredential_ciphertext_base64url_check'
                   AND convalidated
                   AND definition =
                     'CHECK(ciphertext~''^[A-Za-z0-9_-]{24,2048}$''::text)'
               )::integer AS superseded_ciphertext_constraint_count,
               count(*) FILTER (
                 WHERE conname = 'WorkspaceAiCredential_ciphertext_base64url_length_check'
               )::integer AS modulo_constraint_count,
               count(*) FILTER (
                 WHERE conname = 'WorkspaceAiCredential_ciphertext_base64url_length_check'
                   AND convalidated
                   AND definition = 'CHECK((char_length(ciphertext)%4)<>1)'
               )::integer AS exact_modulo_constraint_count
        FROM credential_constraints
      ),
      credential_rows AS (
        SELECT count(*) FILTER (
                 WHERE credential.ciphertext IS NULL
                    OR credential.ciphertext !~ '^[A-Za-z0-9_-]+$'
                    OR char_length(credential.ciphertext) NOT BETWEEN 24 AND 2048
                    OR char_length(credential.ciphertext) % 4 = 1
               )::bigint AS invalid_credential_count
        FROM public."WorkspaceAiCredential" credential
      )
      SELECT current_database() AS "databaseName",
             current_user AS "migrationRole",
             ledger_state.applied_count = expected.ledger_count
               AND ledger_state.newest_timestamp = expected.newest_timestamp
               AND ledger_state.newest_hash = expected.newest_hash
               AS "ledgerMatches",
             ledger_state.superseded_0018_hash_count = 0
               AND CASE
                 WHEN expected.after_0018 THEN
                   ledger_state.timestamp_0018_count = 1
                   AND ledger_state.final_0018_hash_count = 1
                   AND ledger_state.final_0018_pair_count = 1
                 ELSE
                   ledger_state.timestamp_0018_count = 0
                   AND ledger_state.final_0018_hash_count = 0
                   AND ledger_state.final_0018_pair_count = 0
               END AS "unexpected0018Clear",
             command_drain.nonterminal_count = 0 AS "commandsDrained",
             statistics_visibility.can_inspect_other_transactions
               AND transaction_state.long_transaction_count = 0
               AND transaction_state.prepared_transaction_count = 0
               AS "longTransactionsClear",
             lock_state.waiting_lock_count = 0 AS "waitingLocksClear",
             lock_state.target_waiting_lock_count = 0 AS "targetWaitingLocksClear",
             relation_ownership.relation_count = 3
               AND relation_ownership.owned_relation_count = 3
               AND CASE
                 WHEN expected.after_0017 THEN
                   publication_kind.type_count = 1
                   AND publication_kind.owned_type_count = 1
                 ELSE publication_kind.type_count = 0
               END AS "ownershipMatches",
             has_schema_privilege(current_user, 'public', 'USAGE')
               AND has_schema_privilege(current_user, 'public', 'CREATE')
               AND has_database_privilege(current_user, current_database(), 'CREATE')
               AND has_schema_privilege(current_user, 'drizzle', 'USAGE')
               AND has_schema_privilege(current_user, 'drizzle', 'CREATE')
               AND has_table_privilege(
                 current_user,
                 'drizzle.__drizzle_migrations',
                 'SELECT'
               )
               AND has_table_privilege(
                 current_user,
                 'drizzle.__drizzle_migrations',
                 'INSERT'
               )
               AND has_sequence_privilege(
                 current_user,
                 'drizzle.__drizzle_migrations_id_seq',
                 'USAGE'
               )
               AS "schemaPrivilegesMatch",
             CASE
               WHEN expected.after_0017 THEN
                 publication_kind.type_count = 1
                 AND publication_kind.labels = ARRAY['post', 'article']::text[]
               ELSE
                 publication_kind.type_count = 0
                 AND publication_kind.labels = ARRAY[]::text[]
             END AS "publicationKindMatches",
             CASE
               WHEN expected.after_0017 THEN
                 kind_columns.draft_column_count = 1
                 AND kind_columns.exact_draft_column_count = 1
               ELSE kind_columns.draft_column_count = 0
             END AS "draftKindColumnMatches",
             CASE
               WHEN expected.after_0017 THEN
                 kind_columns.command_column_count = 1
                 AND kind_columns.exact_command_column_count = 1
               ELSE kind_columns.command_column_count = 0
             END AS "commandKindColumnMatches",
             kind_rows.draft_null_count = 0 AS "draftKindRowsMatch",
             kind_rows.command_null_count = 0 AS "commandKindRowsMatch",
             version_default.definition_count = 1
               AND version_default.expression = CASE
                 WHEN expected.after_0017 THEN '3'
                 ELSE '2'
               END AS "draftVersionDefaultMatches",
             version_constraint.constraint_count = 1
               AND version_constraint.validated_constraint_count = 1
               AND version_constraint.definition = CASE
                 WHEN expected.after_0017 THEN 'CHECK(version=ANY(ARRAY[2,3]))'
                 ELSE 'CHECK(version=2)'
               END AS "draftVersionConstraintMatches",
             CASE
               WHEN expected.after_0017 THEN
                 draft_index_state.old_index_count = 0
                 AND draft_index_state.target_only_index_count = 0
                 AND draft_index_state.new_index_count = 1
                 AND draft_index_state.exact_new_index_count = 1
                 AND draft_index_state.target_kind_index_count = 1
               ELSE
                 draft_index_state.old_index_count = 1
                 AND draft_index_state.exact_old_index_count = 1
                 AND draft_index_state.target_only_index_count = 1
                 AND draft_index_state.new_index_count = 0
                 AND draft_index_state.target_kind_index_count = 0
             END AS "draftIndexesMatch",
             credential_constraint_state.ciphertext_constraint_count = 1
               AND CASE
                 WHEN expected.after_0018 THEN
                   credential_constraint_state.repaired_ciphertext_constraint_count = 1
                 ELSE
                   credential_constraint_state.superseded_ciphertext_constraint_count = 1
               END AS "ciphertextConstraintMatches",
             credential_constraint_state.modulo_constraint_count = 1
               AND credential_constraint_state.exact_modulo_constraint_count = 1
               AS "moduloConstraintMatches",
             credential_rows.invalid_credential_count = 0 AS "credentialRowsMatch"
      FROM expected
      CROSS JOIN ledger_state
      CROSS JOIN command_drain
      CROSS JOIN transaction_state
      CROSS JOIN statistics_visibility
      CROSS JOIN lock_state
      CROSS JOIN relation_ownership
      CROSS JOIN publication_kind
      CROSS JOIN kind_columns
      CROSS JOIN kind_rows
      CROSS JOIN version_default
      CROSS JOIN version_constraint
      CROSS JOIN draft_index_state
      CROSS JOIN credential_constraint_state
      CROSS JOIN credential_rows
    `;

    if (
      rows?.length !== 1 ||
      rows[0]?.databaseName !== environment.EXPECTED_PRODUCTION_DATABASE_NAME ||
      rows[0]?.migrationRole !== environment.EXPECTED_PRODUCTION_MIGRATION_ROLE ||
      REQUIRED_CHECK_FIELDS.some((field) => rows[0]?.[field] !== true)
    ) fail();
  } catch {
    throw new Error(FAILURE_MESSAGE);
  }
}

/**
 * @param {{
 *   args?: string[];
 *   environment?: Record<string, string | undefined>;
 *   createSql?: (databaseUrl: string) => (
 *     strings: TemplateStringsArray,
 *     ...values: unknown[]
 *   ) => Promise<Array<Record<string, unknown>>>;
 *   log?: (message: string) => void;
 *   error?: (message: string) => void;
 * }} [options]
 */
export async function runProductionCutoverStateCheck({
  args = process.argv.slice(2),
  environment = process.env,
  createSql = neon,
  log = console.log,
  error = console.error,
} = {}) {
  try {
    if (!Array.isArray(args) || args.length !== 1) fail();
    await verifyProductionCutoverState({
      stage: args[0],
      environment,
      createSql,
    });
    log(SUCCESS_MESSAGE);
    return 0;
  } catch {
    error(FAILURE_MESSAGE);
    return 1;
  }
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) process.exitCode = await runProductionCutoverStateCheck();
