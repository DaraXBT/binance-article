import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as databaseSchema from './schema';
import { publicationDraft, publisherCommand } from './schema';

const root = fileURLToPath(new URL('../../', import.meta.url));
const migrationFiles = readdirSync(`${root}drizzle`)
  .filter((name) => /^(?:001[7-9]|00[2-9][0-9])_.*\.sql$/.test(name))
  .sort();
const migrationSql = migrationFiles
  .map((name) => readFileSync(`${root}drizzle/${name}`, 'utf8'))
  .join('\n');
const journalPath = `${root}drizzle/meta/_journal.json`;
const journal = existsSync(journalPath)
  ? JSON.parse(readFileSync(journalPath, 'utf8')) as { entries?: Array<{ idx?: number; tag?: string }> }
  : {};

describe('publication kind persistence', () => {
  it('models kind independently from the platform target', () => {
    const kindEnum = (databaseSchema as Record<string, unknown>).publicationKind as {
      enumName?: string;
      enumValues?: string[];
    } | undefined;
    const draftKind = (publicationDraft as unknown as Record<string, {
      name?: string;
      notNull?: boolean;
    } | undefined>).kind;
    const commandKind = (publisherCommand as unknown as Record<string, {
      name?: string;
      notNull?: boolean;
    } | undefined>).kind;

    expect(kindEnum?.enumName).toBe('PublicationKind');
    expect(kindEnum?.enumValues).toEqual(['post', 'article']);
    expect(draftKind).toMatchObject({ name: 'kind', notNull: true });
    expect(commandKind).toMatchObject({ name: 'kind', notNull: true });
  });

  it('adds and backfills kind without rewriting legacy recipes or hashes', () => {
    expect(migrationFiles.length, 'a publication-kind migration after 0016 must exist').toBeGreaterThan(0);
    expect(migrationSql).toMatch(
      /CREATE TYPE "public"\."PublicationKind" AS ENUM\('post', 'article'\)/,
    );
    expect(migrationSql).toMatch(/ALTER TABLE "PublicationDraft" ADD COLUMN "kind" "PublicationKind"/);
    expect(migrationSql).toMatch(/ALTER TABLE "PublisherCommand" ADD COLUMN "kind" "PublicationKind"/);
    expect(migrationSql).toMatch(
      /UPDATE "PublicationDraft"[\s\S]*"target"\s*=\s*'x'[\s\S]*'post'[\s\S]*'article'/i,
    );
    expect(migrationSql).toMatch(
      /UPDATE "PublisherCommand"[\s\S]*"target"\s*=\s*'x'[\s\S]*'post'[\s\S]*'article'/i,
    );
    expect(migrationSql).toMatch(/ALTER TABLE "PublicationDraft" ALTER COLUMN "kind" SET NOT NULL/);
    expect(migrationSql).toMatch(/ALTER TABLE "PublisherCommand" ALTER COLUMN "kind" SET NOT NULL/);
    expect(migrationSql).not.toMatch(/UPDATE[\s\S]*"recipeHash"\s*=/i);
    expect(migrationSql).not.toMatch(/DROP (?:TABLE|COLUMN|TYPE)/i);
  });

  it('replaces target-only draft uniqueness with target-and-kind uniqueness', () => {
    expect(migrationSql).toMatch(
      /DROP INDEX "PublicationDraft_workspaceId_articleId_target_key"/,
    );
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX "PublicationDraft_workspaceId_articleId_target_kind_key"[\s\S]*\("workspaceId","articleId","target","kind"\)/,
    );
  });

  it('registers every new SQL migration in the Drizzle journal', () => {
    for (const migrationFile of migrationFiles) {
      const tag = migrationFile.replace(/\.sql$/, '');
      expect(journal.entries).toContainEqual(expect.objectContaining({ tag }));
    }
  });
});
