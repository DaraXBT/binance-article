import { existsSync, readFileSync } from 'node:fs';
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
const workspaceOriginMigrationPath = `${root}drizzle/0007_workspace_origin.sql`;
const workspaceOriginSql = existsSync(workspaceOriginMigrationPath)
  ? readFileSync(workspaceOriginMigrationPath, 'utf8')
  : '';
const telegramAiMigrationPath = `${root}drizzle/0008_telegram_ai_workflow.sql`;
const telegramAiSql = existsSync(telegramAiMigrationPath)
  ? readFileSync(telegramAiMigrationPath, 'utf8')
  : '';
const telegramIllustrationStylesMigrationPath = `${root}drizzle/0009_telegram_illustration_styles.sql`;
const telegramIllustrationStylesSql = existsSync(telegramIllustrationStylesMigrationPath)
  ? readFileSync(telegramIllustrationStylesMigrationPath, 'utf8')
  : '';
const binanceMasterDefaultMigrationPath = `${root}drizzle/0010_binance_master_default.sql`;
const binanceMasterDefaultSql = existsSync(binanceMasterDefaultMigrationPath)
  ? readFileSync(binanceMasterDefaultMigrationPath, 'utf8')
  : '';
const publicationV2Sql = readFileSync(`${root}drizzle/0012_fresh_lady_deathstrike.sql`, 'utf8');
const publicationBackfillSql = readFileSync(
  `${root}drizzle/0013_publication_draft_backfill.sql`,
  'utf8',
);
const webApprovalDefaultMigrationPath = `${root}drizzle/0014_web_approval_default.sql`;
const webApprovalDefaultSql = existsSync(webApprovalDefaultMigrationPath)
  ? readFileSync(webApprovalDefaultMigrationPath, 'utf8')
  : '';
const workspaceAiCredentialMigrationPath = `${root}drizzle/0015_workspace_ai_credential.sql`;
const workspaceAiCredentialSql = existsSync(workspaceAiCredentialMigrationPath)
  ? readFileSync(workspaceAiCredentialMigrationPath, 'utf8')
  : '';
const migrationJournal = JSON.parse(
  readFileSync(`${root}drizzle/meta/_journal.json`, 'utf8'),
) as { entries?: Array<{ idx?: number; tag?: string }> };
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

  it('adds a fail-closed workspace origin and backfills only exact account prefixes', () => {
    expect(workspaceOriginSql, 'drizzle/0007_workspace_origin.sql must exist').not.toBe('');
    expect(workspaceOriginSql).toMatch(
      /CREATE TYPE "public"\."WorkspaceOrigin" AS ENUM\('legacy', 'account'\)/,
    );
    expect(workspaceOriginSql).toMatch(/ADD COLUMN "origin" "WorkspaceOrigin"/);
    expect(workspaceOriginSql).toContain('^acct_[a-f0-9]{8}$');
    expect(workspaceOriginSql).toContain(`'account'::"WorkspaceOrigin"`);
    expect(workspaceOriginSql).toContain(`'legacy'::"WorkspaceOrigin"`);
    expect(workspaceOriginSql).toMatch(/ALTER COLUMN "origin" SET DEFAULT 'legacy'/);
    expect(workspaceOriginSql).toMatch(/ALTER COLUMN "origin" SET NOT NULL/);
    expect(migrationJournal.entries).toContainEqual(expect.objectContaining({
      idx: 7,
      tag: '0007_workspace_origin',
    }));
  });

  it('adds Telegram AI preferences, idempotent tasks, short-lived messages, and private media without provider keys', () => {
    expect(telegramAiSql, 'drizzle/0008_telegram_ai_workflow.sql must exist').not.toBe('');
    for (const table of ['TelegramAssistantSettings', 'TelegramAiTask', 'TelegramAiMessage', 'TelegramMedia']) {
      expect(telegramAiSql).toContain(`CREATE TABLE "${table}"`);
    }
    expect(telegramAiSql).toContain('TelegramAiTask_botId_updateId_key');
    expect(telegramAiSql).toContain("ALTER TYPE \"public\".\"StorageObjectPurpose\" ADD VALUE 'telegram_image'");
    expect(telegramAiSql).not.toMatch(/apiKey|botToken|clientSecret/i);
    expect(migrationJournal.entries).toContainEqual(expect.objectContaining({
      idx: 8,
      tag: '0008_telegram_ai_workflow',
    }));
  });

  it('widens the Telegram illustration-style constraint without rewriting history', () => {
    expect(
      telegramIllustrationStylesSql,
      'drizzle/0009_telegram_illustration_styles.sql must exist',
    ).not.toBe('');
    expect(telegramIllustrationStylesSql).toContain(
      'DROP CONSTRAINT "TelegramAssistantSettings_illustrationStyle_check"',
    );
    expect(telegramIllustrationStylesSql).toMatch(
      /ALTER TABLE "TelegramAssistantSettings"[\s\S]*ADD CONSTRAINT "TelegramAssistantSettings_illustrationStyle_check"[\s\S]*CHECK/,
    );
    for (const style of [
      'pixel-art',
      'fantasy-animation',
      'lab-notes',
      'binance',
      'binance-master',
      'binance-briefing',
      'binance-mondo-panoramic',
      'binance-sketch-notes',
      'binance-vector-illustration',
    ]) {
      expect(telegramIllustrationStylesSql).toContain(`'${style}'`);
    }
    expect(telegramIllustrationStylesSql).not.toMatch(
      /ALTER TABLE "(?:Workspace|WorkspaceSession|DeckProject|Slide|CaptionPackage|RenderAsset|JobRun)"/i,
    );
    expect(telegramIllustrationStylesSql).not.toMatch(/CREATE TABLE|DROP TABLE|ALTER TYPE/i);
    expect(migrationJournal.entries).toContainEqual(expect.objectContaining({
      idx: 9,
      tag: '0009_telegram_illustration_styles',
    }));
  });

  it('makes Binance Master the persistence default without rewriting saved styles', () => {
    expect(
      binanceMasterDefaultSql,
      'drizzle/0010_binance_master_default.sql must exist',
    ).not.toBe('');
    for (const table of ['DeckProject', 'TelegramAssistantSettings']) {
      expect(binanceMasterDefaultSql).toContain(
        `ALTER TABLE "${table}" ALTER COLUMN "illustrationStyle" SET DEFAULT 'binance-master'`,
      );
    }
    expect(binanceMasterDefaultSql).not.toMatch(/\bUPDATE\b|DROP TABLE|ALTER TYPE/i);
    expect(migrationJournal.entries).toContainEqual(expect.objectContaining({
      idx: 10,
      tag: '0010_binance_master_default',
    }));
  });

  it('expands publication storage for Binance Square and X without dropping the legacy table', () => {
    expect(publicationV2Sql).toContain(
      `CREATE TYPE "public"."PublicationTarget" AS ENUM('binance-square', 'x')`,
    );
    expect(publicationV2Sql).toContain('CREATE TABLE "PublicationDraft"');
    expect(publicationV2Sql).toContain('ADD COLUMN "publicationDraftId" text');
    expect(publicationV2Sql).toContain('ADD COLUMN "approvedVia" "PublishApprovalVia"');
    expect(publicationV2Sql).not.toMatch(/DROP TABLE|DROP COLUMN/i);
    expect(publicationBackfillSql).toMatch(/INSERT INTO "PublicationDraft"/);
    expect(publicationBackfillSql).toContain(`'binance-square'::"PublicationTarget"`);
    expect(publicationBackfillSql).toMatch(/ON CONFLICT DO NOTHING/);
    expect(publicationBackfillSql).toMatch(
      /jsonb_build_object\([\s\S]*\),\s*NULL,\s*legacy\."expiresAt"/,
    );
    expect(publicationBackfillSql).toMatch(
      /command\."state" IN \([\s\S]*'succeeded'[\s\S]*'outcome_unknown'[\s\S]*\)/,
    );
    expect(publicationBackfillSql).not.toMatch(
      /command\."state" IN \([\s\S]*'queued'::"PublisherCommandState"/,
    );
    expect(publicationBackfillSql).not.toMatch(/DROP TABLE|DROP COLUMN|ALTER TABLE/i);
    expect(migrationJournal.entries).toContainEqual(expect.objectContaining({
      idx: 12,
      tag: '0012_fresh_lady_deathstrike',
    }));
    expect(migrationJournal.entries).toContainEqual(expect.objectContaining({
      idx: 13,
      tag: '0013_publication_draft_backfill',
    }));
  });

  it('defaults new approval records to the web-only review flow while retaining legacy rows', () => {
    expect(
      webApprovalDefaultSql,
      'drizzle/0014_web_approval_default.sql must exist',
    ).not.toBe('');
    expect(webApprovalDefaultSql).toContain(
      `ALTER TABLE "PublishApproval" ALTER COLUMN "approvedVia" SET DEFAULT 'web'`,
    );
    expect(webApprovalDefaultSql).not.toMatch(/\bUPDATE\b|DROP TABLE|DROP COLUMN|ALTER TYPE/i);
    expect(migrationJournal.entries).toContainEqual(expect.objectContaining({
      idx: 14,
      tag: '0014_web_approval_default',
    }));
  });

  it('adds bounded encrypted Gemini credentials without destructive schema changes or plaintext fields', () => {
    expect(
      workspaceAiCredentialSql,
      'drizzle/0015_workspace_ai_credential.sql must exist',
    ).not.toBe('');
    expect(workspaceAiCredentialSql).toContain(
      `CREATE TYPE "public"."AiCredentialProvider" AS ENUM('gemini')`,
    );
    expect(workspaceAiCredentialSql).toContain('CREATE TABLE "WorkspaceAiCredential"');
    expect(workspaceAiCredentialSql).toContain('"ciphertext" text NOT NULL');
    expect(workspaceAiCredentialSql).toContain('"nonce" text NOT NULL');
    expect(workspaceAiCredentialSql).toContain('"encryptionKeyId" text NOT NULL');
    expect(workspaceAiCredentialSql).toContain('"enabled" boolean DEFAULT false NOT NULL');
    expect(workspaceAiCredentialSql).toContain(
      'WorkspaceAiCredential_workspaceId_provider_key',
    );
    expect(workspaceAiCredentialSql).toContain(
      "ciphertext\" ~ '^[A-Za-z0-9_-]{24,2048}$'",
    );
    expect(workspaceAiCredentialSql).toContain(
      'char_length("WorkspaceAiCredential"."ciphertext") % 4 <> 1',
    );
    expect(workspaceAiCredentialSql).toContain(
      "nonce\" ~ '^[A-Za-z0-9_-]{16}$'",
    );
    expect(workspaceAiCredentialSql).toContain(
      "encryptionKeyId\" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'",
    );
    expect(workspaceAiCredentialSql).not.toMatch(/DROP TABLE|DROP COLUMN|ALTER TYPE/i);
    expect(workspaceAiCredentialSql).not.toMatch(
      /"(?:apiKey|plaintext|keyHash|keySuffix|mask|providerResponse)"/i,
    );
    expect(migrationJournal.entries).toContainEqual(expect.objectContaining({
      idx: 15,
      tag: '0015_workspace_ai_credential',
    }));
  });

  it('verifies baseline structure beyond column-name sets before stamping history', () => {
    expect(baselineScript).toMatch(/data_type/i);
    expect(baselineScript).toMatch(/is_nullable/i);
    expect(baselineScript).toMatch(/column_default/i);
    expect(baselineScript).toMatch(/pg_constraint/i);
    expect(baselineScript).not.toMatch(/FROM\s+pg_constraint\s+constraint\b/i);
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
