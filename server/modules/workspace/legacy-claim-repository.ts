import type { AppDatabase } from '@/server/db/client';

import { ACCOUNT_WORKSPACE_LOCK_SEED } from './account-repository';
import type { LegacyWorkspaceClaimRepository } from './legacy-claim-service';

type ClaimRow = { id?: unknown; replacedWorkspace?: unknown };

function readClaim(rows: unknown): { id: string; replacedWorkspace: boolean } | null {
  if (!Array.isArray(rows)) throw new Error('Legacy workspace claim returned invalid data.');
  const row = rows[0] as ClaimRow | undefined;
  return typeof row?.id === 'string' && typeof row.replacedWorkspace === 'boolean'
    ? { id: row.id, replacedWorkspace: row.replacedWorkspace }
    : null;
}

export function createLegacyWorkspaceClaimRepository(
  database: AppDatabase,
): LegacyWorkspaceClaimRepository {
  return {
    async claimByRecoveryHash(input) {
      const results = await database.$client.transaction((transaction) => [
        transaction`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${input.actorUserId}, ${ACCOUNT_WORKSPACE_LOCK_SEED})
          )
        `,
        transaction`
          SELECT locked_workspace."id"
          FROM "Workspace" AS locked_workspace
          WHERE (
               locked_workspace."accessKeyHash" = ${input.accessKeyHash}
               AND locked_workspace."legacyClaimExpiresAt" > ${input.now}
             )
             OR locked_workspace."id" IN (
               SELECT actor_member."workspaceId"
               FROM "WorkspaceMember" AS actor_member
               WHERE actor_member."userId" = ${input.actorUserId}
             )
          ORDER BY locked_workspace."id"
          FOR UPDATE
        `,
        transaction`
          WITH active_actor AS MATERIALIZED (
            SELECT actor."id"
            FROM "user" AS actor
            WHERE actor."id" = ${input.actorUserId}
              AND actor."status" = 'active'::"UserStatus"
          ), candidate AS MATERIALIZED (
            SELECT candidate_workspace."id"
            FROM "Workspace" AS candidate_workspace
            WHERE candidate_workspace."accessKeyHash" = ${input.accessKeyHash}
              AND candidate_workspace."origin" = 'legacy'::"WorkspaceOrigin"
              AND candidate_workspace."accessKeyPrefix" ~ '^dwk_[a-f0-9]{8}$'
              AND candidate_workspace."legacyClaimExpiresAt" IS NOT NULL
              AND candidate_workspace."legacyClaimExpiresAt" > ${input.now}
              AND NOT EXISTS (
                SELECT 1 FROM "WorkspaceMember" AS candidate_member
                WHERE candidate_member."workspaceId" = candidate_workspace."id"
              )
          ), actor_membership AS MATERIALIZED (
            SELECT
              current_workspace."id" AS "workspaceId",
              current_workspace."origin",
              current_workspace."accessKeyPrefix",
              current_workspace."legacyClaimExpiresAt",
              current_member."role",
              current_member."legacyClaimedAt"
            FROM "WorkspaceMember" AS current_member
            INNER JOIN "Workspace" AS current_workspace
              ON current_workspace."id" = current_member."workspaceId"
            WHERE current_member."userId" = ${input.actorUserId}
          ), eligible AS MATERIALIZED (
            SELECT
              candidate."id" AS "targetWorkspaceId",
              actor_membership."workspaceId" AS "replacedAccountWorkspaceId"
            FROM candidate
            INNER JOIN active_actor ON true
            LEFT JOIN actor_membership ON true
            WHERE actor_membership."workspaceId" IS NULL
               OR (
                 actor_membership."workspaceId" <> candidate."id"
                 AND actor_membership."origin" = 'account'::"WorkspaceOrigin"
                 AND actor_membership."accessKeyPrefix" ~ '^acct_[a-f0-9]{8}$'
                 AND actor_membership."legacyClaimExpiresAt" IS NULL
                 AND actor_membership."role" = 'owner'::"WorkspaceMemberRole"
                 AND actor_membership."legacyClaimedAt" IS NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM "WorkspaceMember" AS other_member
                   WHERE other_member."workspaceId" = actor_membership."workspaceId"
                     AND other_member."userId" <> ${input.actorUserId}
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM "WorkspaceSession"
                   WHERE "workspaceId" = actor_membership."workspaceId"
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM "DeckProject"
                   WHERE "workspaceId" = actor_membership."workspaceId"
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM "JobRun"
                   WHERE "workspaceId" = actor_membership."workspaceId"
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM "UsageLedger"
                   WHERE "workspaceId" = actor_membership."workspaceId"
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM "StorageObject"
                   WHERE "workspaceId" = actor_membership."workspaceId"
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM "BinancePublicationDraft"
                   WHERE "workspaceId" = actor_membership."workspaceId"
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM "PublisherDevice"
                   WHERE "workspaceId" = actor_membership."workspaceId"
                 )
               )
          ), moved_member AS (
            UPDATE "WorkspaceMember" AS member
            SET "workspaceId" = eligible."targetWorkspaceId",
                "role" = 'owner'::"WorkspaceMemberRole",
                "legacyClaimedAt" = ${input.now},
                "updatedAt" = ${input.now}
            FROM eligible
            WHERE eligible."replacedAccountWorkspaceId" IS NOT NULL
              AND member."workspaceId" = eligible."replacedAccountWorkspaceId"
              AND member."userId" = ${input.actorUserId}
            RETURNING eligible."targetWorkspaceId", eligible."replacedAccountWorkspaceId"
          ), inserted_member AS (
            INSERT INTO "WorkspaceMember" (
              "workspaceId", "userId", "role", "legacyClaimedAt", "createdAt", "updatedAt"
            )
            SELECT
              eligible."targetWorkspaceId", ${input.actorUserId},
              'owner'::"WorkspaceMemberRole", ${input.now}, ${input.now}, ${input.now}
            FROM eligible
            WHERE eligible."replacedAccountWorkspaceId" IS NULL
            ON CONFLICT DO NOTHING
            RETURNING "workspaceId" AS "targetWorkspaceId", NULL::text AS "replacedAccountWorkspaceId"
          ), attached AS MATERIALIZED (
            SELECT * FROM moved_member
            UNION ALL
            SELECT * FROM inserted_member
          ), rebound_grants AS (
            UPDATE "GenerationAccessGrant" AS access_grant
            SET "boundWorkspaceId" = attached."targetWorkspaceId",
                "updatedAt" = ${input.now}
            FROM attached
            WHERE attached."replacedAccountWorkspaceId" IS NOT NULL
              AND access_grant."boundWorkspaceId" = attached."replacedAccountWorkspaceId"
            RETURNING access_grant."id"
          ), consumed_workspace AS (
            UPDATE "Workspace" AS claimed_workspace
            SET "legacyClaimExpiresAt" = NULL,
                "updatedAt" = ${input.now}
            FROM attached
            WHERE claimed_workspace."id" = attached."targetWorkspaceId"
              AND claimed_workspace."legacyClaimExpiresAt" > ${input.now}
            RETURNING claimed_workspace."id"
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
              jsonb_build_object('source', 'recovery_key') || jsonb_build_object(
                'replacedAccountWorkspaceId', attached."replacedAccountWorkspaceId",
                'transferredGenerationGrantCount', (SELECT count(*) FROM rebound_grants),
                'deletedLegacySessionCount', (SELECT count(*) FROM deleted_sessions)
              ),
              ${input.now}
            FROM consumed_workspace
            INNER JOIN attached ON attached."targetWorkspaceId" = consumed_workspace."id"
            RETURNING "workspaceId"
          )
          SELECT "workspaceId" FROM audit_event
        `,
        transaction`
          WITH claim AS MATERIALIZED (
            SELECT
              audit."workspaceId" AS "targetWorkspaceId",
              NULLIF(audit."metadata"->>'replacedAccountWorkspaceId', '') AS "oldWorkspaceId"
            FROM "AuditEvent" AS audit
            WHERE audit."id" = ${input.auditEventId}
              AND audit."actorUserId" = ${input.actorUserId}
              AND audit."eventType" = 'workspace.legacy_claimed'
          ), deleted_placeholder AS (
            DELETE FROM "Workspace" AS placeholder
            USING claim
            WHERE claim."oldWorkspaceId" IS NOT NULL
              AND placeholder."id" = claim."oldWorkspaceId"
              AND placeholder."origin" = 'account'::"WorkspaceOrigin"
              AND NOT EXISTS (
                SELECT 1 FROM "WorkspaceMember" AS remaining_member
                WHERE remaining_member."workspaceId" = placeholder."id"
              )
            RETURNING placeholder."id"
          )
          SELECT
            claim."targetWorkspaceId" AS "id",
            (claim."oldWorkspaceId" IS NOT NULL) AS "replacedWorkspace",
            CASE
              WHEN claim."oldWorkspaceId" IS NULL OR EXISTS (SELECT 1 FROM deleted_placeholder)
                THEN 1
              ELSE 1 / (
                length(claim."oldWorkspaceId") - length(claim."oldWorkspaceId")
              )
            END AS "replacementGuard"
          FROM claim
        `,
      ], { isolationLevel: 'ReadCommitted' });

      return readClaim(results[3]);
    },
  };
}
