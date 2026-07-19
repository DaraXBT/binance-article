import type { AppDatabase } from '@/server/db/client';

import type { AccountWorkspaceRepository } from './account-service';

const ACCOUNT_WORKSPACE_LOCK_SEED = 6_284_191;

export function createAccountWorkspaceRepository(
  database: AppDatabase,
): AccountWorkspaceRepository {
  return {
    async createOrFind(input) {
      const [, resultRows] = await database.$client.transaction((transaction) => [
        transaction`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${input.actorUserId}, ${ACCOUNT_WORKSPACE_LOCK_SEED})
          )
        `,
        transaction`
          WITH active_actor AS (
            SELECT actor."id"
            FROM "user" AS actor
            WHERE actor."id" = ${input.actorUserId}
              AND actor."status" = 'active'::"UserStatus"
          ), existing_membership AS (
            SELECT member."workspaceId" AS "id", false AS "created"
            FROM "WorkspaceMember" AS member
            INNER JOIN active_actor ON active_actor."id" = member."userId"
          ), created_workspace AS (
            INSERT INTO "Workspace" (
              "id", "accessKeyHash", "accessKeyPrefix", "legacyClaimExpiresAt",
              "createdAt", "updatedAt"
            )
            SELECT
              ${input.workspaceId}, ${input.accessKeyHash}, ${input.accessKeyPrefix},
              NULL, ${input.now}, ${input.now}
            FROM active_actor
            WHERE NOT EXISTS (SELECT 1 FROM existing_membership)
            ON CONFLICT DO NOTHING
            RETURNING "id"
          ), created_membership AS (
            INSERT INTO "WorkspaceMember" (
              "workspaceId", "userId", "role", "legacyClaimedAt", "createdAt", "updatedAt"
            )
            SELECT
              created_workspace."id", ${input.actorUserId},
              'owner'::"WorkspaceMemberRole", NULL, ${input.now}, ${input.now}
            FROM created_workspace
            ON CONFLICT DO NOTHING
            RETURNING "workspaceId"
          ), audit_event AS (
            INSERT INTO "AuditEvent" (
              "id", "actorUserId", "workspaceId", "eventType", "subjectType",
              "subjectId", "metadata", "createdAt"
            )
            SELECT
              ${input.auditEventId}, ${input.actorUserId}, created_workspace."id",
              'workspace.created', 'workspace', created_workspace."id",
              jsonb_build_object('source', 'account'), ${input.now}
            FROM created_workspace
            INNER JOIN created_membership
              ON created_membership."workspaceId" = created_workspace."id"
            RETURNING "workspaceId"
          )
          SELECT existing_membership."id", existing_membership."created"
          FROM existing_membership
          UNION ALL
          SELECT created_workspace."id", true AS "created"
          FROM created_workspace
          INNER JOIN created_membership
            ON created_membership."workspaceId" = created_workspace."id"
          INNER JOIN audit_event
            ON audit_event."workspaceId" = created_workspace."id"
          LIMIT 1
        `,
      ], { isolationLevel: 'ReadCommitted' });

      const row = (resultRows as Array<{ id?: unknown; created?: unknown }>)[0];
      return typeof row?.id === 'string' && typeof row.created === 'boolean'
        ? { id: row.id, created: row.created }
        : null;
    },
  };
}
