import { and, desc, eq, gt } from 'drizzle-orm';

import type { AppDatabase } from '@/server/db/client';
import { invitation } from '@/server/db/schema';
import { ENROLLMENT_CAPACITY_LOCK_KEY } from '@/server/modules/enrollment/repository';

import type { InvitationAdminRepository } from './service';

export function createInvitationAdminRepository(
  database: AppDatabase,
): InvitationAdminRepository {
  return {
    async insertWithinCapacity(input, capacity) {
      const client = database.$client;
      const [, decisionRows] = await client.transaction((transaction) => [
        transaction`SELECT pg_advisory_xact_lock(${ENROLLMENT_CAPACITY_LOCK_KEY})`,
        transaction`
          WITH capacity AS MATERIALIZED (
            SELECT
              (SELECT count(*)
                FROM "user"
                WHERE "status" = 'active'::"UserStatus") +
              (SELECT count(*)
                FROM "Invitation" AS live_invitation
                WHERE (
                    live_invitation."status" = 'pending'::"InvitationStatus"
                    OR (
                      live_invitation."status" = 'accepted'::"InvitationStatus"
                      AND live_invitation."acceptedByUserId" IS NULL
                    )
                  )
                  AND live_invitation."expiresAt" > ${input.now}
                  AND NOT EXISTS (
                    SELECT 1
                    FROM "EnrollmentClaim" AS legacy_claim
                    WHERE legacy_claim."sourceReferenceId" = live_invitation."id"
                      AND legacy_claim."source" IN ('legacy_invitation', 'bootstrap')
                      AND legacy_claim."status" = 'reserved'::"EnrollmentClaimStatus"
                      AND legacy_claim."reservationExpiresAt" > ${input.now}
                      AND legacy_claim."expiresAt" > ${input.now}
                  )) +
              (SELECT count(*)
                FROM "EnrollmentClaim" AS reserved_claim
                WHERE reserved_claim."status" = 'reserved'::"EnrollmentClaimStatus"
                  AND reserved_claim."reservationExpiresAt" > ${input.now}
                  AND reserved_claim."expiresAt" > ${input.now}) AS used
          ), decision AS (
            SELECT CASE
              WHEN (SELECT used FROM capacity) >= ${capacity} THEN 'cap_reached'
              WHEN EXISTS (
                SELECT 1 FROM "Invitation" AS existing_invitation
                WHERE lower(existing_invitation."email") = ${input.email}
                  AND (
                    existing_invitation."status" = 'pending'::"InvitationStatus"
                    OR (
                      existing_invitation."status" = 'accepted'::"InvitationStatus"
                      AND existing_invitation."acceptedByUserId" IS NULL
                    )
                  )
                  AND existing_invitation."expiresAt" > ${input.now}
              ) THEN 'duplicate'
              ELSE 'created'
            END AS result
          ), inserted AS (
            INSERT INTO "Invitation" (
              "id", "email", "tokenHash", "tokenPrefix", "status", "createdByUserId",
              "expiresAt", "createdAt", "updatedAt"
            )
            SELECT
              ${input.id}, ${input.email}, ${input.tokenHash}, ${input.tokenPrefix},
              'pending'::"InvitationStatus", ${input.createdByUserId}, ${input.expiresAt}, ${input.now}, ${input.now}
            FROM decision
            WHERE result = 'created'
            RETURNING "id"
          )
          SELECT result, (SELECT "id" FROM inserted) AS id FROM decision
        `,
      ], { isolationLevel: 'ReadCommitted' });

      const result = decisionRows[0]?.result;
      if (result === 'created' || result === 'cap_reached' || result === 'duplicate') return result;
      throw new Error('Invitation capacity decision failed.');
    },

    async findPendingByHash({ tokenHash, now }) {
      const rows = await database
        .select({ id: invitation.id, email: invitation.email, expiresAt: invitation.expiresAt })
        .from(invitation)
        .where(and(
          eq(invitation.tokenHash, tokenHash),
          eq(invitation.status, 'pending'),
          gt(invitation.expiresAt, now),
        ))
        .limit(1);
      return rows[0] ?? null;
    },

    async list(limit) {
      return database
        .select({
          id: invitation.id,
          email: invitation.email,
          tokenPrefix: invitation.tokenPrefix,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
        })
        .from(invitation)
        .orderBy(desc(invitation.createdAt), desc(invitation.id))
        .limit(limit);
    },

    async revoke({ invitationId, now }) {
      const [, resultRows] = await database.$client.transaction((transaction) => [
        transaction`SELECT pg_advisory_xact_lock(${ENROLLMENT_CAPACITY_LOCK_KEY})`,
        transaction`
          WITH target AS MATERIALIZED (
            SELECT "id"
            FROM "Invitation"
            WHERE "id" = ${invitationId}
              AND (
                "status" = 'pending'::"InvitationStatus"
                OR (
                  "status" = 'accepted'::"InvitationStatus"
                  AND "acceptedByUserId" IS NULL
                )
              )
            FOR UPDATE
          ), revoked_claims AS (
            UPDATE "EnrollmentClaim" AS claim
            SET
              "status" = 'revoked'::"EnrollmentClaimStatus",
              "reservationExpiresAt" = NULL,
              "revokedAt" = ${now},
              "failureCode" = 'invitation_revoked',
              "updatedAt" = ${now}
            FROM target
            WHERE claim."sourceReferenceId" = target."id"
              AND claim."source" IN ('legacy_invitation', 'bootstrap')
              AND claim."status" IN (
                'pending'::"EnrollmentClaimStatus",
                'reserved'::"EnrollmentClaimStatus"
              )
            RETURNING claim."id"
          ), revoked_invitation AS (
            UPDATE "Invitation" AS target_invitation
            SET
              "status" = 'revoked'::"InvitationStatus",
              "revokedAt" = ${now},
              "updatedAt" = ${now}
            FROM target
            WHERE target_invitation."id" = target."id"
            RETURNING target_invitation."id"
          )
          SELECT
            EXISTS (SELECT 1 FROM revoked_invitation) AS revoked,
            (SELECT count(*) FROM revoked_claims) AS "revokedClaims"
        `,
      ], { isolationLevel: 'ReadCommitted' });

      const revoked = resultRows[0]?.revoked;
      if (typeof revoked === 'boolean') return revoked;
      throw new Error('Invitation revocation decision failed.');
    },
  };
}
