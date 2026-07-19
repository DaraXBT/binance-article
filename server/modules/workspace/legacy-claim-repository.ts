import type { AppDatabase } from '@/server/db/client';

import type { LegacyWorkspaceClaimRepository } from './legacy-claim-service';

export function createLegacyWorkspaceClaimRepository(
  database: AppDatabase,
): LegacyWorkspaceClaimRepository {
  return {
    async claimByRecoveryHash(input) {
      const rows = await database.$client`
        WITH candidate AS MATERIALIZED (
          SELECT workspace."id"
          FROM "Workspace" AS workspace
          WHERE workspace."accessKeyHash" = ${input.accessKeyHash}
            AND workspace."legacyClaimExpiresAt" IS NOT NULL
            AND workspace."legacyClaimExpiresAt" > ${input.now}
          FOR UPDATE
        ), inserted_member AS (
          INSERT INTO "WorkspaceMember" (
            "workspaceId", "userId", "role", "legacyClaimedAt", "createdAt", "updatedAt"
          )
          SELECT
            candidate."id", ${input.actorUserId}, 'owner'::"WorkspaceMemberRole",
            ${input.now}, ${input.now}, ${input.now}
          FROM candidate
          WHERE EXISTS (
            SELECT 1 FROM "user" AS actor
            WHERE actor."id" = ${input.actorUserId}
              AND actor."status" = 'active'::"UserStatus"
          )
            AND NOT EXISTS (
              SELECT 1 FROM "WorkspaceMember" AS member
              WHERE member."workspaceId" = candidate."id"
            )
            AND NOT EXISTS (
              SELECT 1 FROM "WorkspaceMember" AS actor_membership
              WHERE actor_membership."userId" = ${input.actorUserId}
            )
          ON CONFLICT DO NOTHING
          RETURNING "workspaceId"
        ), consumed_workspace AS (
          UPDATE "Workspace" AS workspace
          SET "legacyClaimExpiresAt" = NULL,
              "updatedAt" = ${input.now}
          FROM inserted_member
          WHERE workspace."id" = inserted_member."workspaceId"
            AND workspace."legacyClaimExpiresAt" > ${input.now}
          RETURNING workspace."id"
        ), deleted_sessions AS (
          DELETE FROM "WorkspaceSession" AS legacy_session
          USING consumed_workspace
          WHERE legacy_session."workspaceId" = consumed_workspace."id"
          RETURNING legacy_session."id"
        ), audit_event AS (
          INSERT INTO "AuditEvent" (
            "id", "actorUserId", "workspaceId", "eventType", "subjectType",
            "subjectId", "metadata", "createdAt"
          )
          SELECT
            ${input.auditEventId}, ${input.actorUserId}, consumed_workspace."id",
            'workspace.legacy_claimed', 'workspace', consumed_workspace."id",
            jsonb_build_object('source', 'recovery_key'), ${input.now}
          FROM consumed_workspace
          RETURNING "workspaceId"
        )
        SELECT consumed_workspace."id",
               (SELECT count(*) FROM deleted_sessions) AS "deletedSessionCount"
        FROM consumed_workspace
        INNER JOIN inserted_member
          ON inserted_member."workspaceId" = consumed_workspace."id"
        INNER JOIN audit_event
          ON audit_event."workspaceId" = consumed_workspace."id"
      `;
      const row = (rows as Array<{ id?: unknown }>)[0];
      return typeof row?.id === 'string' ? { id: row.id } : null;
    },
  };
}
