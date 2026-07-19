import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import packageJson from '../../package.json';

const root = fileURLToPath(new URL('../../', import.meta.url));
const legacySql = readFileSync(`${root}drizzle/0000_legacy_baseline.sql`, 'utf8');
const cloudSql = readFileSync(`${root}drizzle/0001_cloud_identity_publishing.sql`, 'utf8');
const approvalGuardsSql = readFileSync(`${root}drizzle/0003_publish_approval_guards.sql`, 'utf8');
const legacyClaimSql = readFileSync(`${root}drizzle/0004_legacy_workspace_claim.sql`, 'utf8');

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
});
