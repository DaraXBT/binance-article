import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const migration = readFileSync(`${root}drizzle/0016_shared_enrollment.sql`, 'utf8');
const journal = JSON.parse(readFileSync(`${root}drizzle/meta/_journal.json`, 'utf8')) as {
  entries?: Array<{ idx?: number; tag?: string }>;
};

describe('shared enrollment migration', () => {
  it('bounds the access-exclusive enum rewrite inside the migration transaction', () => {
    expect(migration).toMatch(/^SET LOCAL lock_timeout = '5s';--> statement-breakpoint/);
    expect(migration).toContain("SET LOCAL statement_timeout = '2min';--> statement-breakpoint");
    expect(migration.indexOf('SET LOCAL lock_timeout')).toBeLessThan(
      migration.indexOf('ALTER TYPE "public"."UserStatus"'),
    );
    expect(migration.indexOf('SET LOCAL statement_timeout')).toBeLessThan(
      migration.indexOf('ALTER TYPE "public"."UserStatus"'),
    );
  });

  it('adds pending auth state and durable versioned enrollment records', () => {
    expect(migration).toContain(`ALTER TYPE "public"."UserStatus" RENAME TO "UserStatus_legacy"`);
    expect(migration).toContain(
      `CREATE TYPE "public"."UserStatus" AS ENUM('pending', 'active', 'suspended', 'revoked')`,
    );
    expect(migration).not.toContain(`ALTER TYPE "public"."UserStatus" ADD VALUE 'pending'`);
    expect(migration).toContain(
      `ALTER COLUMN "status" TYPE "public"."UserStatus" USING "status"::text::"public"."UserStatus"`,
    );
    expect(migration).toContain(`ALTER TABLE "user" ALTER COLUMN "status" SET DEFAULT 'pending'`);
    expect(migration).toContain('CREATE TABLE "EnrollmentCode"');
    expect(migration).toContain('CREATE TABLE "EnrollmentClaim"');
    expect(migration).toContain('EnrollmentCode_one_active_key');
    expect(migration).toContain('EnrollmentClaim_tokenHash_key');
    expect(migration).not.toMatch(/"code" text|"token" text/);
  });

  it('enforces hash, source-binding, and lifecycle invariants in PostgreSQL', () => {
    for (const constraint of [
      'EnrollmentCode_codeHash_hmac_check',
      'EnrollmentCode_lifecycle_check',
      'EnrollmentClaim_tokenHash_sha256_check',
      'EnrollmentClaim_source_binding_check',
      'EnrollmentClaim_lifecycle_check',
      'EnrollmentClaim_expiry_check',
    ]) {
      expect(migration).toContain(constraint);
    }
    expect(migration).toContain('CREATE UNIQUE INDEX "EnrollmentClaim_legacy_sourceReferenceId_key"');
    expect(migration).toMatch(
      /"EnrollmentClaim_legacy_sourceReferenceId_key"[\s\S]*\("sourceReferenceId"\)[\s\S]*WHERE "EnrollmentClaim"\."source" IN \('legacy_invitation', 'bootstrap'\)/,
    );
  });

  it('is registered after the current migration history', () => {
    expect(journal.entries).toContainEqual(expect.objectContaining({
      idx: 16,
      tag: '0016_shared_enrollment',
    }));
  });
});
