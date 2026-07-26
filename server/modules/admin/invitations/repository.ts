import { and, desc, eq, gt } from 'drizzle-orm';

import type { AppDatabase } from '@/server/db/client';
import { invitation } from '@/server/db/schema';

import type { InvitationAdminRepository } from './service';

const CAPACITY_LOCK_KEY = 8_194_261;

export function createInvitationAdminRepository(
  database: AppDatabase,
): InvitationAdminRepository {
  return {
    async insertWithinCapacity(input, capacity) {
      const client = database.$client;
      const [, decisionRows] = await client.transaction((transaction) => [
        transaction`SELECT pg_advisory_xact_lock(${CAPACITY_LOCK_KEY})`,
        transaction`
          WITH decision AS (
            SELECT CASE
              WHEN (
                (SELECT count(*) FROM "user" WHERE "status" = 'active') +
                (SELECT count(*) FROM "Invitation" WHERE "status" = 'pending' AND "expiresAt" > ${input.now})
              ) >= ${capacity} THEN 'cap_reached'
              WHEN EXISTS (
                SELECT 1 FROM "Invitation"
                WHERE lower("email") = ${input.email}
                  AND "status" = 'pending'
                  AND "expiresAt" > ${input.now}
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
      const rows = await database
        .update(invitation)
        .set({ status: 'revoked', revokedAt: now, updatedAt: now })
        .where(and(eq(invitation.id, invitationId), eq(invitation.status, 'pending')))
        .returning({ id: invitation.id });
      return Boolean(rows[0]);
    },
  };
}
