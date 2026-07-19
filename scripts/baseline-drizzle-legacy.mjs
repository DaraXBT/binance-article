import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { neon } from '@neondatabase/serverless';

const LEGACY_MIGRATION = new URL('../drizzle/0000_legacy_baseline.sql', import.meta.url);
const LEGACY_SNAPSHOT = new URL('../drizzle/meta/0000_snapshot.json', import.meta.url);
const JOURNAL = new URL('../drizzle/meta/_journal.json', import.meta.url);

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

function expectedColumnDataType(type) {
  if (type === 'text' || type === 'jsonb' || type === 'integer') return type;
  if (type === 'timestamp (3)') return 'timestamp without time zone';
  return 'USER-DEFINED';
}

function columnDefaultMatches(actual, expected) {
  if (expected === undefined) return actual === null;
  if (actual === null) return false;

  const normalizedActual = String(actual).trim();
  const normalizedExpected = String(expected).trim();
  if (/^(?:now\(\)|CURRENT_TIMESTAMP)$/i.test(normalizedExpected)) {
    return /^(?:now\(\)|CURRENT_TIMESTAMP)$/i.test(normalizedActual);
  }
  if (/^'.*'$/.test(normalizedExpected)) {
    return normalizedActual === normalizedExpected ||
      normalizedActual.startsWith(`${normalizedExpected}::`);
  }
  return normalizedActual === normalizedExpected;
}

function assertReviewedColumn(tableName, actual, expected) {
  const expectedDataType = expectedColumnDataType(expected.type);
  const expectedNullable = expected.notNull ? 'NO' : 'YES';
  const typeMatches = actual.dataType === expectedDataType &&
    (expectedDataType !== 'USER-DEFINED' || actual.udtName === expected.type) &&
    (expected.type !== 'timestamp (3)' || Number(actual.datetimePrecision) === 3);

  if (
    !typeMatches ||
    actual.isNullable !== expectedNullable ||
    !columnDefaultMatches(actual.columnDefault, expected.default)
  ) {
    throw new Error(
      `Legacy column ${tableName}.${expected.name} does not match the reviewed type, nullability, or default.`,
    );
  }
}

function foreignKeyAction(code) {
  return {
    a: 'no action',
    c: 'cascade',
    d: 'set default',
    n: 'set null',
    r: 'restrict',
  }[code];
}

function foreignKeySignature(value) {
  return [
    value.tableFrom,
    value.columnsFrom.join(','),
    value.tableTo,
    value.columnsTo.join(','),
    value.onDelete,
    value.onUpdate,
  ].join('|');
}

async function main() {
  if (process.env.ALLOW_LEGACY_DRIZZLE_BASELINE !== '1') {
    throw new Error(
      'Refusing to baseline. Back up and inspect the database, then set ALLOW_LEGACY_DRIZZLE_BASELINE=1.',
    );
  }

  const databaseUrl = assertMigrationUrl(process.env.MIGRATION_DATABASE_URL);
  const db = neon(databaseUrl);
  const legacySnapshot = JSON.parse(await readFile(LEGACY_SNAPSHOT, 'utf8'));
  const expectedTables = Object.values(legacySnapshot.tables);

  const cloudTables = ['user', 'Invitation', 'WorkspaceMember', 'PublisherDevice'];
  for (const tableName of cloudTables) {
    const [row] = await db`SELECT to_regclass(${`public."${tableName}"`}) IS NOT NULL AS "exists"`;
    if (row?.exists) {
      throw new Error(`Cloud table ${tableName} already exists; this database must not be legacy-baselined.`);
    }
  }

  const [obsoleteRenderJob] = await db`
    SELECT to_regclass('public."RenderJob"') IS NOT NULL AS "exists"
  `;
  if (obsoleteRenderJob?.exists) {
    throw new Error('Obsolete RenderJob exists; complete the reviewed legacy repair before baselining.');
  }

  for (const expectedTable of expectedTables) {
    const tableName = expectedTable.name;
    const expectedColumns = Object.values(expectedTable.columns);
    const rows = await db`
      SELECT
        column_name AS "columnName",
        data_type AS "dataType",
        udt_name AS "udtName",
        is_nullable AS "isNullable",
        column_default AS "columnDefault",
        datetime_precision AS "datetimePrecision"
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${tableName}
      ORDER BY ordinal_position
    `;
    if (!sameMembers(
      rows.map((row) => row.columnName),
      expectedColumns.map((column) => column.name),
    )) {
      throw new Error(`Legacy table ${tableName} does not match the reviewed baseline.`);
    }

    for (const expectedColumn of expectedColumns) {
      const actualColumn = rows.find((row) => row.columnName === expectedColumn.name);
      assertReviewedColumn(tableName, actualColumn, expectedColumn);
    }

    const indexes = await db`
      SELECT
        index_relation.relname AS "indexName",
        indexed.indisunique AS "isUnique",
        array_to_json(
          array_agg(index_column.attname ORDER BY key_column.ordinality)
        ) AS "columns"
      FROM pg_index indexed
      JOIN pg_class table_relation ON table_relation.oid = indexed.indrelid
      JOIN pg_namespace namespace ON namespace.oid = table_relation.relnamespace
      JOIN pg_class index_relation ON index_relation.oid = indexed.indexrelid
      JOIN LATERAL unnest(indexed.indkey) WITH ORDINALITY
        AS key_column(attnum, ordinality)
        ON key_column.ordinality <= indexed.indnkeyatts
      JOIN pg_attribute index_column
        ON index_column.attrelid = table_relation.oid
        AND index_column.attnum = key_column.attnum
      WHERE namespace.nspname = 'public' AND table_relation.relname = ${tableName}
      GROUP BY indexed.indexrelid, index_relation.relname, indexed.indisunique
    `;
    const expectedIndexNames = [
      `${tableName}_pkey`,
      ...Object.keys(expectedTable.indexes),
    ];
    if (!sameMembers(indexes.map((index) => index.indexName), expectedIndexNames)) {
      throw new Error(`Legacy indexes for ${tableName} do not match the reviewed baseline.`);
    }

    for (const expectedIndex of Object.values(expectedTable.indexes)) {
      const actualIndex = indexes.find((index) => index.indexName === expectedIndex.name);
      const expectedColumns = expectedIndex.columns.map((column) => column.expression);
      const columnsMatch = actualIndex?.columns.length === expectedColumns.length &&
        actualIndex.columns.every((column, index) => column === expectedColumns[index]);
      if (actualIndex?.isUnique !== expectedIndex.isUnique || !columnsMatch) {
        throw new Error(`Legacy index ${expectedIndex.name} does not match the reviewed baseline.`);
      }
    }
  }

  const primaryKeys = await db`
    SELECT
      source.relname AS "tableName",
      array_to_json(
        array_agg(attribute.attname ORDER BY key_column.ordinality)
      ) AS "columns"
    FROM pg_constraint AS reviewed_constraint
    JOIN pg_class source ON source.oid = reviewed_constraint.conrelid
    JOIN pg_namespace namespace ON namespace.oid = source.relnamespace
    JOIN LATERAL unnest(reviewed_constraint.conkey) WITH ORDINALITY
      AS key_column(attnum, ordinality) ON TRUE
    JOIN pg_attribute attribute
      ON attribute.attrelid = source.oid AND attribute.attnum = key_column.attnum
    WHERE namespace.nspname = 'public' AND reviewed_constraint.contype = 'p'
    GROUP BY reviewed_constraint.oid, source.relname
  `;
  const expectedPrimaryKeys = expectedTables.map((table) => ({
    tableName: table.name,
    columns: Object.values(table.columns)
      .filter((column) => column.primaryKey)
      .map((column) => column.name),
  }));
  const expectedTableNames = new Set(expectedTables.map((table) => table.name));
  const reviewedPrimaryKeys = primaryKeys.filter((key) => expectedTableNames.has(key.tableName));
  if (!sameMembers(
    reviewedPrimaryKeys.map((key) => `${key.tableName}|${key.columns.join(',')}`),
    expectedPrimaryKeys.map((key) => `${key.tableName}|${key.columns.join(',')}`),
  )) {
    throw new Error('Legacy primary keys do not match the reviewed baseline.');
  }

  const foreignKeys = await db`
    SELECT
      source.relname AS "tableFrom",
      target.relname AS "tableTo",
      array_to_json(
        array_agg(source_attribute.attname ORDER BY key_column.ordinality)
      ) AS "columnsFrom",
      array_to_json(
        array_agg(target_attribute.attname ORDER BY key_column.ordinality)
      ) AS "columnsTo",
      reviewed_constraint.confdeltype AS "deleteAction",
      reviewed_constraint.confupdtype AS "updateAction"
    FROM pg_constraint AS reviewed_constraint
    JOIN pg_class source ON source.oid = reviewed_constraint.conrelid
    JOIN pg_namespace namespace ON namespace.oid = source.relnamespace
    JOIN pg_class target ON target.oid = reviewed_constraint.confrelid
    JOIN LATERAL unnest(
      reviewed_constraint.conkey,
      reviewed_constraint.confkey
    ) WITH ORDINALITY
      AS key_column(source_attnum, target_attnum, ordinality) ON TRUE
    JOIN pg_attribute source_attribute
      ON source_attribute.attrelid = source.oid
      AND source_attribute.attnum = key_column.source_attnum
    JOIN pg_attribute target_attribute
      ON target_attribute.attrelid = target.oid
      AND target_attribute.attnum = key_column.target_attnum
    WHERE namespace.nspname = 'public' AND reviewed_constraint.contype = 'f'
    GROUP BY
      reviewed_constraint.oid,
      source.relname,
      target.relname,
      reviewed_constraint.confdeltype,
      reviewed_constraint.confupdtype
  `;
  const expectedForeignKeys = expectedTables.flatMap((table) =>
    Object.values(table.foreignKeys)
  );
  const actualForeignKeys = foreignKeys
    .filter((foreignKey) => expectedTableNames.has(foreignKey.tableFrom))
    .map((foreignKey) => ({
      ...foreignKey,
      onDelete: foreignKeyAction(foreignKey.deleteAction),
      onUpdate: foreignKeyAction(foreignKey.updateAction),
    }));
  if (!sameMembers(
    actualForeignKeys.map(foreignKeySignature),
    expectedForeignKeys.map(foreignKeySignature),
  )) {
    throw new Error('Legacy foreign keys do not match the reviewed baseline.');
  }

  const enumRows = await db`
    SELECT
      type.typname AS "enumName",
      enum.enumlabel AS "enumValue"
    FROM pg_type type
    JOIN pg_enum enum ON enum.enumtypid = type.oid
    JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'public'
    ORDER BY type.typname, enum.enumsortorder
  `;
  const actualEnums = Object.groupBy(enumRows, (row) => row.enumName);
  const expectedEnums = Object.values(legacySnapshot.enums);
  if (!sameMembers(
    Object.entries(actualEnums).map(([name, rows]) =>
      `${name}|${rows.map((row) => row.enumValue).join(',')}`
    ),
    expectedEnums.map((value) => `${value.name}|${value.values.join(',')}`),
  )) {
    throw new Error('Legacy enum definitions do not match the reviewed baseline.');
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
