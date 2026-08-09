import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import * as databaseSchema from '@/server/db/schema';
import { enrollmentClaim, enrollmentCode, user } from '@/server/db/schema';

const TABLE_NAME = Symbol.for('drizzle:Name');

function tableName(table: object): string {
  return (table as Record<symbol, string>)[TABLE_NAME];
}

describe('shared enrollment schema', () => {
  it('defines versioned codes and durable claims without raw bearer secrets', () => {
    expect(tableName(enrollmentCode)).toBe('EnrollmentCode');
    expect(tableName(enrollmentClaim)).toBe('EnrollmentClaim');

    expect(Object.keys(enrollmentCode)).toEqual(expect.arrayContaining([
      'id', 'version', 'codeHash', 'codePrefix', 'status', 'createdByUserId',
      'revokedByUserId', 'revokedAt', 'revocationReason', 'createdAt', 'updatedAt',
    ]));
    expect(Object.keys(enrollmentCode)).not.toContain('code');

    expect(Object.keys(enrollmentClaim)).toEqual(expect.arrayContaining([
      'id', 'tokenHash', 'tokenPrefix', 'codeId', 'codeVersion', 'source',
      'sourceReferenceId', 'status', 'email', 'userId', 'idempotencyKeyHash',
      'expiresAt', 'reservationExpiresAt', 'completedAt', 'revokedAt',
      'failureCode', 'createdAt', 'updatedAt',
    ]));
    expect(Object.keys(enrollmentClaim)).not.toContain('token');
  });

  it('exports the complete enrollment lifecycle enums', () => {
    const schema = databaseSchema as Record<string, unknown>;
    const codeStatus = schema.enrollmentCodeStatus as { enumName?: string; enumValues?: string[] };
    const claimSource = schema.enrollmentClaimSource as { enumName?: string; enumValues?: string[] };
    const claimStatus = schema.enrollmentClaimStatus as { enumName?: string; enumValues?: string[] };
    expect(codeStatus.enumName).toBe('EnrollmentCodeStatus');
    expect(codeStatus.enumValues).toEqual(['active', 'revoked']);
    expect(claimSource.enumName).toBe('EnrollmentClaimSource');
    expect(claimSource.enumValues).toEqual(['shared_code', 'legacy_invitation', 'bootstrap']);
    expect(claimStatus.enumName).toBe('EnrollmentClaimStatus');
    expect(claimStatus.enumValues).toEqual([
      'pending', 'reserved', 'completed', 'expired', 'revoked',
    ]);
  });

  it('defaults new database users to pending until enrollment completes', () => {
    const statusColumn = user.status as unknown as { hasDefault?: boolean; default?: unknown };
    expect(statusColumn.hasDefault).toBe(true);
    expect(statusColumn.default).toBe('pending');
  });

  it('allows only one durable claim per legacy invitation source', () => {
    const legacySourceIndex = getTableConfig(enrollmentClaim).indexes.find(
      (index) => index.config.name === 'EnrollmentClaim_legacy_sourceReferenceId_key',
    );

    expect(legacySourceIndex?.config.unique).toBe(true);
    expect(legacySourceIndex?.config.columns.map((column) => 'name' in column ? column.name : null))
      .toEqual(['sourceReferenceId']);
    expect(legacySourceIndex?.config.where).toBeTruthy();
  });
});
