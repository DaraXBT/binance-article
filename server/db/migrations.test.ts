import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import packageJson from '../../package.json';

const root = fileURLToPath(new URL('../../', import.meta.url));
const legacySql = readFileSync(`${root}drizzle/0000_legacy_baseline.sql`, 'utf8');
const cloudSql = readFileSync(`${root}drizzle/0001_cloud_identity_publishing.sql`, 'utf8');
const approvalGuardsSql = readFileSync(`${root}drizzle/0003_publish_approval_guards.sql`, 'utf8');
const legacyClaimSql = readFileSync(`${root}drizzle/0004_legacy_workspace_claim.sql`, 'utf8');
const singleWorkspaceSql = readFileSync(`${root}drizzle/0005_single_user_workspace.sql`, 'utf8');
const normalizeLegacyForeignKeysSql = readFileSync(
  `${root}drizzle/0006_normalize_legacy_foreign_keys.sql`,
  'utf8',
);
const baselineScript = readFileSync(`${root}scripts/baseline-drizzle-legacy.mjs`, 'utf8');

describe('Neon migration history', () => {
  it('has a clean legacy baseline instead of replaying the historical Prisma repair chain', () => {
    for (const table of [
      'Workspace',
      'WorkspaceSession',
      'DeckProject',
      'Slide',
      'CaptionPackage',
      'RenderAsset',
      'JobRun',
      'RateLimitBucket',
      'GenerationAccessGrant',
    ]) {
      expect(legacySql).toContain(`CREATE TABLE "${table}"`);
    }
    expect(legacySql).not.toMatch(/DROP\s+(?:TABLE|COLUMN|TYPE)/i);
  });

  it('adds auth and cloud publishing without altering legacy tables', () => {
    for (const table of [
      'user',
      'session',
      'account',
      'verification',
      'Invitation',
      'WorkspaceMember',
      'UserQuota',
      'StorageObject',
      'BinancePublicationDraft',
      'PublisherDevice',
      'PublisherCommand',
      'PublishApproval',
      'AuditEvent',
      'TelegramUpdate',
    ]) {
      expect(cloudSql).toContain(`CREATE TABLE "${table}"`);
    }
    expect(cloudSql).not.toMatch(/(?:ALTER|DROP) TABLE "(?:Workspace|DeckProject|Slide)"/i);
  });

  it('persists hashes and private R2 keys but no Binance or OAuth credentials in publishing tables', () => {
    expect(cloudSql).toContain('"callbackTokenHash" text NOT NULL');
    expect(cloudSql).toContain('"tokenHash" text NOT NULL');
    expect(cloudSql).toContain('"r2Key" text NOT NULL');
    expect(cloudSql).not.toMatch(/binance(?:Cookie|Password|Token)|chromeProfile|signedUrl/i);
  });

  it('keeps migrations out of application builds and uses the dedicated migration URL', () => {
    expect(packageJson.scripts.build).not.toMatch(/migrate/i);
    expect(packageJson.scripts['db:migrate:deploy']).toMatch(/drizzle-kit migrate/);
    expect(packageJson.scripts['db:baseline:legacy']).toMatch(/baseline-drizzle-legacy/);
    expect(packageJson.scripts['db:repair:legacy-json']).toMatch(
      /repair-legacy-json-columns/,
    );
  });

  it('allows only one open approval per command and guards its revision and expiry', () => {
    expect(approvalGuardsSql).toMatch(/CREATE UNIQUE INDEX "PublishApproval_commandId_open_key"/);
    expect(approvalGuardsSql).toMatch(/WHERE "state" IN \('pending', 'confirmation_required'\)/);
    expect(approvalGuardsSql).toMatch(/CHECK \("revision" > 0\)/);
    expect(approvalGuardsSql).toMatch(/CHECK \("expiresAt" > "createdAt"\)/);
  });

  it('opens one immutable 30-day claim window and permits only one workspace owner', () => {
    expect(legacyClaimSql).toMatch(
      /ADD COLUMN "legacyClaimExpiresAt" timestamp\(3\)/,
    );
    expect(legacyClaimSql).toMatch(
      /CURRENT_TIMESTAMP \+ INTERVAL '30 days'/,
    );
    expect(legacyClaimSql).toMatch(/WHERE NOT EXISTS[\s\S]*"WorkspaceMember"/);
    expect(legacyClaimSql).not.toMatch(/DEFAULT[\s\S]*INTERVAL '30 days'/);
    expect(legacyClaimSql).toMatch(
      /CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_owner_key"[\s\S]*WHERE "role" = 'owner'/,
    );
  });

  it('enforces the private-beta invariant of one workspace per account', () => {
    expect(singleWorkspaceSql).toMatch(
      /CREATE UNIQUE INDEX "WorkspaceMember_userId_single_workspace_key"[\s\S]*\("userId"\)/,
    );
  });

  it('conditionally converges every historical Prisma foreign-key name', () => {
    const renames = [
      ['WorkspaceSession', 'WorkspaceSession_workspaceId_fkey', 'WorkspaceSession_workspaceId_Workspace_id_fk'],
      ['DeckProject', 'DeckProject_workspaceId_fkey', 'DeckProject_workspaceId_Workspace_id_fk'],
      ['Slide', 'Slide_deckId_fkey', 'Slide_deckId_DeckProject_id_fk'],
      ['CaptionPackage', 'CaptionPackage_deckId_fkey', 'CaptionPackage_deckId_DeckProject_id_fk'],
      ['RenderAsset', 'RenderAsset_deckId_fkey', 'RenderAsset_deckId_DeckProject_id_fk'],
      ['RenderAsset', 'RenderAsset_jobId_fkey', 'RenderAsset_jobId_JobRun_id_fk'],
      ['JobRun', 'JobRun_deckId_fkey', 'JobRun_deckId_DeckProject_id_fk'],
      ['JobRun', 'JobRun_workspaceId_fkey', 'JobRun_workspaceId_Workspace_id_fk'],
      [
        'GenerationAccessGrant',
        'GenerationAccessGrant_boundWorkspaceId_fkey',
        'GenerationAccessGrant_boundWorkspaceId_Workspace_id_fk',
      ],
    ];

    expect(normalizeLegacyForeignKeysSql).toMatch(/DO\s+\$\$/i);
    expect(normalizeLegacyForeignKeysSql).toMatch(/pg_constraint/i);
    for (const [table, legacyName, drizzleName] of renames) {
      expect(normalizeLegacyForeignKeysSql).toContain(table);
      expect(normalizeLegacyForeignKeysSql).toContain(legacyName);
      expect(normalizeLegacyForeignKeysSql).toContain(drizzleName);
    }
    expect(normalizeLegacyForeignKeysSql).toMatch(/legacy[\s\S]*IS NOT NULL/i);
    expect(normalizeLegacyForeignKeysSql).toMatch(/target[\s\S]*IS NULL/i);
  });

  it('verifies baseline structure beyond column-name sets before stamping history', () => {
    expect(baselineScript).toMatch(/data_type/i);
    expect(baselineScript).toMatch(/is_nullable/i);
    expect(baselineScript).toMatch(/column_default/i);
    expect(baselineScript).toMatch(/pg_constraint/i);
    expect(baselineScript).toMatch(/pg_index/i);
    expect(baselineScript).toMatch(/RenderJob/);
  });

  it('compares index columns through PostgreSQL metadata instead of quoted SQL text', () => {
    expect(baselineScript).toMatch(/FROM pg_index/i);
    expect(baselineScript).toMatch(/JOIN pg_attribute/i);
    expect(baselineScript).toMatch(/indisunique/i);
    expect(baselineScript).toMatch(/array_agg\([\s\S]*attname/i);
    expect(baselineScript).not.toMatch(/indexDefinition\.indexOf/);
  });
});
