import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { user } from './auth';

const enrollmentTimestamp = (name: string) => timestamp(name, {
  mode: 'date',
  precision: 3,
  withTimezone: true,
});

export const enrollmentCodeStatus = pgEnum('EnrollmentCodeStatus', ['active', 'revoked']);
export const enrollmentClaimSource = pgEnum('EnrollmentClaimSource', [
  'shared_code',
  'legacy_invitation',
  'bootstrap',
]);
export const enrollmentClaimStatus = pgEnum('EnrollmentClaimStatus', [
  'pending',
  'reserved',
  'completed',
  'expired',
  'revoked',
]);

export const enrollmentCode = pgTable('EnrollmentCode', {
  id: text('id').primaryKey(),
  version: integer('version').notNull(),
  codeHash: text('codeHash').notNull(),
  codePrefix: text('codePrefix').notNull(),
  status: enrollmentCodeStatus('status').default('active').notNull(),
  createdByUserId: text('createdByUserId').references(() => user.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  revokedByUserId: text('revokedByUserId').references(() => user.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  revokedAt: enrollmentTimestamp('revokedAt'),
  revocationReason: text('revocationReason'),
  createdAt: enrollmentTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: enrollmentTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('EnrollmentCode_version_key').on(table.version),
  unique('EnrollmentCode_id_version_key').on(table.id, table.version),
  uniqueIndex('EnrollmentCode_codeHash_key').on(table.codeHash),
  uniqueIndex('EnrollmentCode_one_active_key')
    .on(table.status)
    .where(sql`${table.status} = 'active'`),
  index('EnrollmentCode_codePrefix_idx').on(table.codePrefix),
  index('EnrollmentCode_status_updatedAt_idx').on(table.status, table.updatedAt),
  check('EnrollmentCode_version_positive_check', sql`${table.version} > 0`),
  check('EnrollmentCode_codeHash_hmac_check', sql`${table.codeHash} ~ '^[a-f0-9]{64}$'`),
  check(
    'EnrollmentCode_codePrefix_crockford_check',
    sql`${table.codePrefix} ~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$'`,
  ),
  check(
    'EnrollmentCode_lifecycle_check',
    sql`(
      ${table.status} = 'active'
      AND ${table.revokedAt} IS NULL
      AND ${table.revokedByUserId} IS NULL
      AND ${table.revocationReason} IS NULL
    ) OR (
      ${table.status} = 'revoked'
      AND ${table.revokedAt} IS NOT NULL
      AND ${table.revocationReason} IS NOT NULL
    )`,
  ),
]);

export const enrollmentClaim = pgTable('EnrollmentClaim', {
  id: text('id').primaryKey(),
  tokenHash: text('tokenHash').notNull(),
  tokenPrefix: text('tokenPrefix').notNull(),
  codeId: text('codeId'),
  codeVersion: integer('codeVersion'),
  source: enrollmentClaimSource('source').notNull(),
  sourceReferenceId: text('sourceReferenceId'),
  status: enrollmentClaimStatus('status').default('pending').notNull(),
  email: text('email'),
  userId: text('userId').references(() => user.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  idempotencyKeyHash: text('idempotencyKeyHash'),
  expiresAt: enrollmentTimestamp('expiresAt').notNull(),
  reservationExpiresAt: enrollmentTimestamp('reservationExpiresAt'),
  completedAt: enrollmentTimestamp('completedAt'),
  revokedAt: enrollmentTimestamp('revokedAt'),
  failureCode: text('failureCode'),
  createdAt: enrollmentTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: enrollmentTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('EnrollmentClaim_tokenHash_key').on(table.tokenHash),
  uniqueIndex('EnrollmentClaim_idempotencyKeyHash_key')
    .on(table.idempotencyKeyHash)
    .where(sql`${table.idempotencyKeyHash} IS NOT NULL`),
  uniqueIndex('EnrollmentClaim_legacy_sourceReferenceId_key')
    .on(table.sourceReferenceId)
    .where(sql`${table.source} IN ('legacy_invitation', 'bootstrap')`),
  index('EnrollmentClaim_codeId_status_idx').on(table.codeId, table.status),
  index('EnrollmentClaim_status_expiresAt_idx').on(table.status, table.expiresAt),
  index('EnrollmentClaim_status_reservationExpiresAt_idx')
    .on(table.status, table.reservationExpiresAt),
  index('EnrollmentClaim_email_status_idx').on(table.email, table.status),
  index('EnrollmentClaim_userId_idx').on(table.userId),
  index('EnrollmentClaim_sourceReferenceId_idx').on(table.sourceReferenceId),
  foreignKey({
    name: 'EnrollmentClaim_code_version_fkey',
    columns: [table.codeId, table.codeVersion],
    foreignColumns: [enrollmentCode.id, enrollmentCode.version],
  }).onDelete('restrict').onUpdate('cascade'),
  check('EnrollmentClaim_tokenHash_sha256_check', sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
  check('EnrollmentClaim_tokenPrefix_check', sql`${table.tokenPrefix} ~ '^[A-Za-z0-9_-]{8}$'`),
  check(
    'EnrollmentClaim_idempotencyKeyHash_check',
    sql`${table.idempotencyKeyHash} IS NULL OR ${table.idempotencyKeyHash} ~ '^[a-f0-9]{64}$'`,
  ),
  check(
    'EnrollmentClaim_codeVersion_positive_check',
    sql`${table.codeVersion} IS NULL OR ${table.codeVersion} > 0`,
  ),
  check(
    'EnrollmentClaim_source_binding_check',
    sql`(
      ${table.source} = 'shared_code'
      AND ${table.codeId} IS NOT NULL
      AND ${table.codeVersion} IS NOT NULL
      AND ${table.sourceReferenceId} IS NULL
    ) OR (
      ${table.source} IN ('legacy_invitation', 'bootstrap')
      AND ${table.codeId} IS NULL
      AND ${table.codeVersion} IS NULL
      AND ${table.sourceReferenceId} IS NOT NULL
    )`,
  ),
  check(
    'EnrollmentClaim_email_normalized_check',
    sql`${table.email} IS NULL OR ${table.email} = lower(btrim(${table.email}))`,
  ),
  check('EnrollmentClaim_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  check(
    'EnrollmentClaim_reservation_expiry_check',
    sql`${table.reservationExpiresAt} IS NULL OR (
      ${table.reservationExpiresAt} > ${table.updatedAt}
      AND ${table.reservationExpiresAt} <= ${table.expiresAt}
    )`,
  ),
  check(
    'EnrollmentClaim_lifecycle_check',
    sql`(
      ${table.status} = 'pending'
      AND ${table.userId} IS NULL
      AND ${table.reservationExpiresAt} IS NULL
      AND ${table.completedAt} IS NULL
      AND ${table.revokedAt} IS NULL
    ) OR (
      ${table.status} = 'reserved'
      AND ${table.email} IS NOT NULL
      AND ${table.userId} IS NULL
      AND ${table.reservationExpiresAt} IS NOT NULL
      AND ${table.completedAt} IS NULL
      AND ${table.revokedAt} IS NULL
    ) OR (
      ${table.status} = 'completed'
      AND ${table.email} IS NOT NULL
      AND ${table.userId} IS NOT NULL
      AND ${table.reservationExpiresAt} IS NULL
      AND ${table.completedAt} IS NOT NULL
      AND ${table.revokedAt} IS NULL
    ) OR (
      ${table.status} = 'expired'
      AND ${table.userId} IS NULL
      AND ${table.reservationExpiresAt} IS NULL
      AND ${table.completedAt} IS NULL
      AND ${table.revokedAt} IS NULL
    ) OR (
      ${table.status} = 'revoked'
      AND ${table.userId} IS NULL
      AND ${table.reservationExpiresAt} IS NULL
      AND ${table.completedAt} IS NULL
      AND ${table.revokedAt} IS NOT NULL
    )`,
  ),
]);
