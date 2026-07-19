import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import type { AppDatabase } from '@/server/db/client';
import { invitation } from '@/server/db/schema';

import type { InvitationEnrollmentRepository } from './invitation-enrollment';

export function createDrizzleInvitationRepository(
  database: AppDatabase,
): InvitationEnrollmentRepository {
  return {
    async reserve({ tokenHash, email, now }) {
      const rows = await database
        .update(invitation)
        .set({
          status: 'accepted',
          acceptedAt: now,
          updatedAt: now,
        })
        .where(and(
          eq(invitation.tokenHash, tokenHash),
          eq(invitation.status, 'pending'),
          gt(invitation.expiresAt, now),
          isNull(invitation.acceptedByUserId),
          sql`lower(${invitation.email}) = ${email}`,
        ))
        .returning({ id: invitation.id });

      return rows[0] ?? null;
    },

    async attachUser({ invitationId, userId, now }) {
      const rows = await database.$client`
        WITH candidate AS (
          SELECT
            "id",
            ("id" LIKE 'bootstrap\\_%' ESCAPE '\\') AS "grantsOwner"
          FROM "Invitation"
          WHERE "id" = ${invitationId}
            AND "status" = 'accepted'
            AND "acceptedByUserId" IS NULL
          FOR UPDATE
        ), other_user AS (
          SELECT 1
          FROM "user"
          WHERE "id" <> ${userId}
          LIMIT 1
        ), promoted_owner AS (
          UPDATE "user"
          SET
            "role" = 'owner'::"UserRole",
            "updatedAt" = ${now}
          WHERE "id" = ${userId}
            AND EXISTS (
              SELECT 1 FROM candidate WHERE "grantsOwner"
            )
            AND NOT EXISTS (SELECT 1 FROM other_user)
          RETURNING "id"
        ), attached AS (
          UPDATE "Invitation"
          SET
            "acceptedByUserId" = ${userId},
            "updatedAt" = ${now}
          WHERE "id" IN (SELECT "id" FROM candidate)
            AND (
              NOT EXISTS (SELECT 1 FROM candidate WHERE "grantsOwner")
              OR EXISTS (SELECT 1 FROM promoted_owner)
            )
          RETURNING "id"
        )
        SELECT "id" FROM attached
      `;

      if (!rows[0]) throw new Error('Invitation reservation could not be linked to the created user.');
    },
  };
}
