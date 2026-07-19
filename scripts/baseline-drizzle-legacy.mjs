import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { neon } from '@neondatabase/serverless';

const LEGACY_MIGRATION = new URL('../drizzle/0000_legacy_baseline.sql', import.meta.url);
const JOURNAL = new URL('../drizzle/meta/_journal.json', import.meta.url);

const expectedColumns = {
  CaptionPackage: [
    'id', 'deckId', 'blogTitle', 'blogMeta', 'blogIntro', 'blogSections', 'blogTags',
    'xSingle1', 'xSingle2', 'xSingle3', 'xThread', 'createdAt', 'updatedAt',
  ],
  DeckProject: [
    'id', 'workspaceId', 'title', 'description', 'content', 'theme', 'customTheme',
    'illustrationStyle', 'status', 'generationRevision', 'lastCompletedRevision', 'createdAt', 'updatedAt',
  ],
  GenerationAccessGrant: [
    'id', 'codeHash', 'codePrefix', 'status', 'boundWorkspaceId', 'boundSessionId',
    'consumedAt', 'envCodeHash', 'createdAt', 'updatedAt',
  ],
  JobRun: [
    'id', 'deckId', 'workspaceId', 'kind', 'status', 'progress', 'logs', 'errorCode',
    'errorMessage', 'articleRevisionId', 'runId', 'payload', 'result', 'startedAt',
    'completedAt', 'createdAt', 'updatedAt',
  ],
  RateLimitBucket: ['key', 'count', 'resetAt', 'createdAt', 'updatedAt'],
  RenderAsset: [
    'id', 'deckId', 'filename', 'format', 'mimeType', 'filePath', 'fileSize',
    'storageProvider', 'jobId', 'createdAt',
  ],
  Slide: [
    'id', 'deckId', 'title', 'subtitle', 'bullets', 'notes', 'imageUrl', 'imageStatus',
    'imageError', 'imagePrompt', 'order', 'createdAt', 'updatedAt',
  ],
  Workspace: ['id', 'accessKeyHash', 'accessKeyPrefix', 'createdAt', 'updatedAt'],
  WorkspaceSession: ['id', 'sessionId', 'workspaceId', 'createdAt', 'updatedAt'],
};

function assertMigrationUrl(value) {
  if (!value?.trim()) throw new Error('MIGRATION_DATABASE_URL is required.');
  const parsed = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('MIGRATION_DATABASE_URL must use PostgreSQL.');
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase());
  if (!local && parsed.searchParams.get('sslmode') !== 'require') {
    throw new Error('Remote MIGRATION_DATABASE_URL must include sslmode=require.');
  }
  return value.trim();
}

function sameMembers(actual, expected) {
  return actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

async function main() {
  if (process.env.ALLOW_LEGACY_DRIZZLE_BASELINE !== '1') {
    throw new Error(
      'Refusing to baseline. Back up and inspect the database, then set ALLOW_LEGACY_DRIZZLE_BASELINE=1.',
    );
  }

  const databaseUrl = assertMigrationUrl(process.env.MIGRATION_DATABASE_URL);
  const db = neon(databaseUrl);

  const cloudTables = ['user', 'Invitation', 'WorkspaceMember', 'PublisherDevice'];
  for (const tableName of cloudTables) {
    const [row] = await db`SELECT to_regclass(${`public."${tableName}"`}) IS NOT NULL AS "exists"`;
    if (row?.exists) {
      throw new Error(`Cloud table ${tableName} already exists; this database must not be legacy-baselined.`);
    }
  }

  for (const [tableName, expected] of Object.entries(expectedColumns)) {
    const rows = await db`
      SELECT column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${tableName}
      ORDER BY ordinal_position
    `;
    const actual = rows.map((row) => row.columnName);
    if (!sameMembers(actual, expected)) {
      throw new Error(`Legacy table ${tableName} does not match the reviewed baseline.`);
    }
  }

  const journal = JSON.parse(await readFile(JOURNAL, 'utf8'));
  const entry = journal.entries.find((candidate) => candidate.idx === 0);
  if (!entry || entry.tag !== '0000_legacy_baseline') {
    throw new Error('The Drizzle legacy journal entry is missing or changed.');
  }
  const migrationSql = await readFile(LEGACY_MIGRATION, 'utf8');
  const migrationHash = createHash('sha256').update(migrationSql).digest('hex');

  await db`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await db`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;

  const existing = await db`
    SELECT hash, created_at AS "createdAt"
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (existing.length > 0) {
    const [latest] = existing;
    if (latest.hash === migrationHash && Number(latest.createdAt) === entry.when) {
      console.info('Legacy Drizzle baseline is already recorded.');
      return;
    }
    throw new Error('A different Drizzle migration is already recorded; refusing to rewrite history.');
  }

  await db`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    VALUES (${migrationHash}, ${entry.when})
  `;
  console.info('Recorded the reviewed legacy baseline. Run db:migrate:deploy to add cloud tables.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Legacy baseline failed.');
  process.exitCode = 1;
});
