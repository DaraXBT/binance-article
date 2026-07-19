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
      const rows = await database
        .update(invitation)
        .set({
          acceptedByUserId: userId,
          updatedAt: now,
        })
        .where(and(
          eq(invitation.id, invitationId),
          eq(invitation.status, 'accepted'),
          isNull(invitation.acceptedByUserId),
        ))
        .returning({ id: invitation.id });

      if (!rows[0]) throw new Error('Invitation reservation could not be linked to the created user.');
    },
  };
}
