import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { neon } from '@neondatabase/serverless';

function isLocalDatabaseHost(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.endsWith('.localhost');
}

function assertMigrationDatabaseUrl(value) {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error('MIGRATION_DATABASE_URL is required.');

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('MIGRATION_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('MIGRATION_DATABASE_URL must use PostgreSQL.');
  }
  if (!parsed.hostname || !parsed.pathname || parsed.pathname === '/') {
    throw new Error('MIGRATION_DATABASE_URL must include a host and database name.');
  }
  if (!isLocalDatabaseHost(parsed.hostname) && parsed.searchParams.get('sslmode') !== 'require') {
    throw new Error('Remote MIGRATION_DATABASE_URL must include sslmode=require.');
  }
  return trimmed;
}

export function assertLegacyJsonRepairEnvironment(environment) {
  if (environment.ALLOW_LEGACY_JSON_REPAIR !== '1') {
    throw new Error(
      'Refusing repair. Set ALLOW_LEGACY_JSON_REPAIR=1 only for the reviewed legacy database.',
    );
  }
  if (environment.CONFIRM_LEGACY_JSON_REPAIR_BACKUP !== '1') {
    throw new Error(
      'CONFIRM_LEGACY_JSON_REPAIR_BACKUP=1 is required after verifying a restorable backup.',
    );
  }
  return {
    databaseUrl: assertMigrationDatabaseUrl(environment.MIGRATION_DATABASE_URL),
  };
}

/**
 * @param {{
 *   environment?: Record<string, string | undefined>;
 *   createSql?: (databaseUrl: string) => any;
 * }} [options]
 */
export async function repairLegacyJsonColumns(options = {}) {
  const environment = options.environment ?? process.env;
  const createSql = options.createSql ?? neon;
  const { databaseUrl } = assertLegacyJsonRepairEnvironment(environment);

  try {
    const sql = createSql(databaseUrl);
    await sql.transaction([
      sql`SET LOCAL lock_timeout = '5s'`,
      sql`SET LOCAL statement_timeout = '2min'`,
      sql`
        DO $legacy_json_repair$
        DECLARE
          legacy_table text;
          reviewed_type text;
          reviewed_nullable text;
        BEGIN
          PERFORM pg_advisory_xact_lock(8194265);

          IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
            RAISE EXCEPTION 'Drizzle migration history already exists; refusing pre-baseline repair';
          END IF;

          IF
            to_regclass('public."user"') IS NOT NULL OR
            to_regclass('public."Invitation"') IS NOT NULL OR
            to_regclass('public."WorkspaceMember"') IS NOT NULL OR
            to_regclass('public."PublisherDevice"') IS NOT NULL
          THEN
            RAISE EXCEPTION 'Cloud tables already exist; refusing pre-baseline repair';
          END IF;

          IF to_regclass('public."RenderJob"') IS NOT NULL THEN
            RAISE EXCEPTION 'Obsolete RenderJob exists; refusing JSON-only repair';
          END IF;

          FOREACH legacy_table IN ARRAY ARRAY[
            'Workspace',
            'WorkspaceSession',
            'DeckProject',
            'Slide',
            'CaptionPackage',
            'JobRun',
            'RateLimitBucket',
            'RenderAsset',
            'GenerationAccessGrant'
          ]
          LOOP
            IF to_regclass(format('public.%I', legacy_table)) IS NULL THEN
              RAISE EXCEPTION 'Expected legacy table % is missing', legacy_table;
            END IF;
          END LOOP;

          IF EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
              AND table_name NOT IN (
                'Workspace',
                'WorkspaceSession',
                'DeckProject',
                'Slide',
                'CaptionPackage',
                'JobRun',
                'RateLimitBucket',
                'RenderAsset',
                'GenerationAccessGrant',
                '_prisma_migrations'
              )
          ) THEN
            RAISE EXCEPTION 'Unexpected public table exists; refusing JSON-only repair';
          END IF;

          LOCK TABLE "CaptionPackage", "DeckProject", "Slide"
            IN ACCESS EXCLUSIVE MODE;

          SELECT data_type, is_nullable
          INTO reviewed_type, reviewed_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'Slide'
            AND column_name = 'bullets';
          IF reviewed_type IS NULL OR
            reviewed_type NOT IN ('text', 'jsonb') OR
            reviewed_nullable <> 'NO'
          THEN
            RAISE EXCEPTION 'Slide.bullets is not a reviewed text/jsonb column';
          END IF;
          IF reviewed_type = 'text' THEN
            IF EXISTS (
              SELECT 1 FROM "Slide"
              WHERE NOT pg_input_is_valid("bullets", 'jsonb')
            ) THEN
              RAISE EXCEPTION 'Slide.bullets contains invalid JSON';
            END IF;
            IF EXISTS (
              SELECT 1 FROM "Slide"
              WHERE jsonb_typeof("bullets"::jsonb) IS DISTINCT FROM 'array'
            ) THEN
              RAISE EXCEPTION 'Slide.bullets contains a non-array JSON value';
            END IF;
            ALTER TABLE "Slide"
              ALTER COLUMN "bullets" TYPE jsonb USING "bullets"::jsonb;
          ELSE
            IF EXISTS (
              SELECT 1 FROM "Slide"
              WHERE jsonb_typeof("bullets") IS DISTINCT FROM 'array'
            ) THEN
              RAISE EXCEPTION 'Slide.bullets contains a non-array JSON value';
            END IF;
          END IF;

          SELECT data_type, is_nullable
          INTO reviewed_type, reviewed_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'CaptionPackage'
            AND column_name = 'blogSections';
          IF reviewed_type IS NULL OR
            reviewed_type NOT IN ('text', 'jsonb') OR
            reviewed_nullable <> 'YES'
          THEN
            RAISE EXCEPTION 'CaptionPackage.blogSections is not a reviewed text/jsonb column';
          END IF;
          IF reviewed_type = 'text' THEN
            IF EXISTS (
              SELECT 1 FROM "CaptionPackage"
              WHERE "blogSections" IS NOT NULL
                AND NOT pg_input_is_valid("blogSections", 'jsonb')
            ) THEN
              RAISE EXCEPTION 'CaptionPackage.blogSections contains invalid JSON';
            END IF;
            IF EXISTS (
              SELECT 1 FROM "CaptionPackage"
              WHERE "blogSections" IS NOT NULL
                AND jsonb_typeof("blogSections"::jsonb) IS DISTINCT FROM 'array'
            ) THEN
              RAISE EXCEPTION 'CaptionPackage.blogSections contains a non-array JSON value';
            END IF;
            ALTER TABLE "CaptionPackage"
              ALTER COLUMN "blogSections" TYPE jsonb USING "blogSections"::jsonb;
          ELSE
            IF EXISTS (
              SELECT 1 FROM "CaptionPackage"
              WHERE "blogSections" IS NOT NULL
                AND jsonb_typeof("blogSections") IS DISTINCT FROM 'array'
            ) THEN
              RAISE EXCEPTION 'CaptionPackage.blogSections contains a non-array JSON value';
            END IF;
          END IF;

          SELECT data_type, is_nullable
          INTO reviewed_type, reviewed_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'CaptionPackage'
            AND column_name = 'blogTags';
          IF reviewed_type IS NULL OR
            reviewed_type NOT IN ('text', 'jsonb') OR
            reviewed_nullable <> 'YES'
          THEN
            RAISE EXCEPTION 'CaptionPackage.blogTags is not a reviewed text/jsonb column';
          END IF;
          IF reviewed_type = 'text' THEN
            IF EXISTS (
              SELECT 1 FROM "CaptionPackage"
              WHERE "blogTags" IS NOT NULL
                AND NOT pg_input_is_valid("blogTags", 'jsonb')
            ) THEN
              RAISE EXCEPTION 'CaptionPackage.blogTags contains invalid JSON';
            END IF;
            IF EXISTS (
              SELECT 1 FROM "CaptionPackage"
              WHERE "blogTags" IS NOT NULL
                AND jsonb_typeof("blogTags"::jsonb) IS DISTINCT FROM 'array'
            ) THEN
              RAISE EXCEPTION 'CaptionPackage.blogTags contains a non-array JSON value';
            END IF;
            ALTER TABLE "CaptionPackage"
              ALTER COLUMN "blogTags" TYPE jsonb USING "blogTags"::jsonb;
          ELSE
            IF EXISTS (
              SELECT 1 FROM "CaptionPackage"
              WHERE "blogTags" IS NOT NULL
                AND jsonb_typeof("blogTags") IS DISTINCT FROM 'array'
            ) THEN
              RAISE EXCEPTION 'CaptionPackage.blogTags contains a non-array JSON value';
            END IF;
          END IF;

          SELECT data_type, is_nullable
          INTO reviewed_type, reviewed_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'DeckProject'
            AND column_name = 'customTheme';
          IF reviewed_type IS NULL OR
            reviewed_type NOT IN ('text', 'jsonb') OR
            reviewed_nullable <> 'YES'
          THEN
            RAISE EXCEPTION 'DeckProject.customTheme is not a reviewed text/jsonb column';
          END IF;
          IF reviewed_type = 'text' THEN
            IF EXISTS (
              SELECT 1 FROM "DeckProject"
              WHERE "customTheme" IS NOT NULL
                AND NOT pg_input_is_valid("customTheme", 'jsonb')
            ) THEN
              RAISE EXCEPTION 'DeckProject.customTheme contains invalid JSON';
            END IF;
            IF EXISTS (
              SELECT 1 FROM "DeckProject"
              WHERE "customTheme" IS NOT NULL
                AND jsonb_typeof("customTheme"::jsonb) IS DISTINCT FROM 'object'
            ) THEN
              RAISE EXCEPTION 'DeckProject.customTheme contains a non-object JSON value';
            END IF;
            ALTER TABLE "DeckProject"
              ALTER COLUMN "customTheme" TYPE jsonb USING "customTheme"::jsonb;
          ELSE
            IF EXISTS (
              SELECT 1 FROM "DeckProject"
              WHERE "customTheme" IS NOT NULL
                AND jsonb_typeof("customTheme") IS DISTINCT FROM 'object'
            ) THEN
              RAISE EXCEPTION 'DeckProject.customTheme contains a non-object JSON value';
            END IF;
          END IF;

          IF (
            SELECT count(*)
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND data_type = 'jsonb'
              AND (table_name, column_name) IN (
                ('Slide', 'bullets'),
                ('CaptionPackage', 'blogSections'),
                ('CaptionPackage', 'blogTags'),
                ('DeckProject', 'customTheme')
              )
          ) <> 4 THEN
            RAISE EXCEPTION 'Legacy JSON repair did not converge all reviewed columns';
          END IF;
        END
        $legacy_json_repair$
      `,
    ], { isolationLevel: 'Serializable' });
  } catch {
    throw new Error('Legacy JSON column repair failed.');
  }

  return { repaired: true };
}

export async function runLegacyJsonRepairCli({
  repair = () => repairLegacyJsonColumns(),
  log = console.log,
  error = console.error,
} = {}) {
  try {
    await repair();
    log('Legacy JSON columns repaired and verified.');
    return 0;
  } catch {
    error('Legacy JSON column repair failed.');
    return 1;
  }
}

const isDirectRun = process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) process.exitCode = await runLegacyJsonRepairCli();
