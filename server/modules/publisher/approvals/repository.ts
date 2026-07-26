import type { AppDatabase } from '@/server/db/client';

import type { WebPublishApprovalRepository, WebPublisherCommand } from './service';

function commandRow(row: Record<string, unknown> | undefined): WebPublisherCommand | null {
  if (!row) return null;
  return {
    id: String(row.id),
    draftId: String(row.draftId),
    target: row.target as WebPublisherCommand['target'],
    state: String(row.state),
    revision: Number(row.revision),
    recipeHash: String(row.recipeHash),
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt : new Date(String(row.expiresAt)),
    resultUrl: row.resultUrl === null || row.resultUrl === undefined ? null : String(row.resultUrl),
    failureReason: row.failureReason === null || row.failureReason === undefined
      ? null
      : String(row.failureReason),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : undefined,
  };
}

export function createWebPublishApprovalRepository(
  database: AppDatabase,
): WebPublishApprovalRepository {
  return {
    async loadCommand({ actorUserId, commandId }) {
      const rows = await database.$client`
        SELECT command."id", COALESCE(draft."id", legacy_draft."id") AS "draftId",
          command."target", command."state", command."revision", command."recipeHash",
          command."expiresAt", command."resultUrl", command."failureReason", command."updatedAt"
        FROM "PublisherCommand" command
        LEFT JOIN "PublicationDraft" draft ON draft."id" = command."publicationDraftId"
        LEFT JOIN "BinancePublicationDraft" legacy_draft ON legacy_draft."id" = command."draftId"
        INNER JOIN "WorkspaceMember" member
          ON member."workspaceId" = COALESCE(draft."workspaceId", legacy_draft."workspaceId")
          AND member."userId" = ${actorUserId}
        INNER JOIN "PublisherDevice" device
          ON device."id" = command."deviceId" AND device."userId" = ${actorUserId}
        WHERE command."id" = ${commandId}
        LIMIT 1
      `;
      return commandRow(rows[0] as Record<string, unknown> | undefined);
    },

    async cancel(input) {
      const rows = await database.$client`
        WITH candidate AS (
          SELECT command."id" AS "commandId", legacy_draft."id" AS "legacyDraftId",
            draft."id" AS "publicationDraftId", COALESCE(draft."id", legacy_draft."id") AS "draftId"
          FROM "PublisherCommand" command
          LEFT JOIN "PublicationDraft" draft ON draft."id" = command."publicationDraftId"
          LEFT JOIN "BinancePublicationDraft" legacy_draft ON legacy_draft."id" = command."draftId"
          INNER JOIN "WorkspaceMember" member
            ON member."workspaceId" = COALESCE(draft."workspaceId", legacy_draft."workspaceId")
            AND member."userId" = ${input.actorUserId}
          INNER JOIN "PublisherDevice" device
            ON device."id" = command."deviceId" AND device."userId" = ${input.actorUserId}
          WHERE command."id" = ${input.commandId}
            AND command."revision" = ${input.revision}
            AND command."recipeHash" = ${input.recipeHash}
            AND command."expiresAt" > ${input.now}
            AND command."state" IN (
              'queued'::"PublisherCommandState", 'claimed'::"PublisherCommandState",
              'awaiting_review'::"PublisherCommandState", 'awaiting_approval'::"PublisherCommandState",
              'approved'::"PublisherCommandState"
            )
          FOR UPDATE OF command
        ), updated_command AS (
          UPDATE "PublisherCommand" command
          SET "state" = 'cancelled'::"PublisherCommandState",
            "failureReason" = 'USER_CANCELLED', "completedAt" = ${input.now}, "updatedAt" = ${input.now}
          FROM candidate WHERE command."id" = candidate."commandId"
          RETURNING command.*
        ), updated_draft AS (
          UPDATE "PublicationDraft" draft
          SET "status" = 'cancelled'::"PublicationDraftStatus", "updatedAt" = ${input.now}
          FROM candidate, updated_command
          WHERE draft."id" = candidate."publicationDraftId"
          RETURNING draft."id"
        ), updated_legacy_draft AS (
          UPDATE "BinancePublicationDraft" draft
          SET "status" = 'cancelled'::"PublicationDraftStatus", "updatedAt" = ${input.now}
          FROM candidate, updated_command
          WHERE draft."id" = candidate."legacyDraftId"
          RETURNING draft."id"
        ), updated_approval AS (
          UPDATE "PublishApproval" approval
          SET "state" = 'cancelled'::"PublishApprovalState",
            "consumedAt" = ${input.now}, "updatedAt" = ${input.now}
          FROM candidate, updated_command
          WHERE approval."commandId" = candidate."commandId"
            AND approval."state" IN (
              'pending'::"PublishApprovalState", 'confirmation_required'::"PublishApprovalState"
            )
          RETURNING approval."id"
        )
        SELECT updated_command."id", candidate."draftId", updated_command."target",
          updated_command."state", updated_command."revision", updated_command."recipeHash",
          updated_command."expiresAt", updated_command."resultUrl", updated_command."failureReason",
          updated_command."updatedAt"
        FROM updated_command
        INNER JOIN candidate ON candidate."commandId" = updated_command."id"
        WHERE EXISTS (SELECT 1 FROM updated_draft) OR EXISTS (SELECT 1 FROM updated_legacy_draft)
      `;
      return commandRow(rows[0] as Record<string, unknown> | undefined);
    },

    async expire(input) {
      const rows = await database.$client`
        WITH candidate AS (
          SELECT command."id" AS "commandId", legacy_draft."id" AS "legacyDraftId",
            draft."id" AS "publicationDraftId", COALESCE(draft."id", legacy_draft."id") AS "draftId"
          FROM "PublisherCommand" command
          LEFT JOIN "PublicationDraft" draft ON draft."id" = command."publicationDraftId"
          LEFT JOIN "BinancePublicationDraft" legacy_draft ON legacy_draft."id" = command."draftId"
          INNER JOIN "WorkspaceMember" member
            ON member."workspaceId" = COALESCE(draft."workspaceId", legacy_draft."workspaceId")
            AND member."userId" = ${input.actorUserId}
          INNER JOIN "PublisherDevice" device
            ON device."id" = command."deviceId" AND device."userId" = ${input.actorUserId}
          WHERE command."id" = ${input.commandId}
            AND command."expiresAt" <= ${input.now}
            AND command."state" IN (
              'queued'::"PublisherCommandState", 'claimed'::"PublisherCommandState",
              'awaiting_review'::"PublisherCommandState", 'awaiting_approval'::"PublisherCommandState",
              'approved'::"PublisherCommandState"
            )
          FOR UPDATE OF command
        ), updated_command AS (
          UPDATE "PublisherCommand" command
          SET "state" = 'expired'::"PublisherCommandState",
            "completedAt" = ${input.now}, "updatedAt" = ${input.now}
          FROM candidate WHERE command."id" = candidate."commandId"
          RETURNING command.*
        ), updated_draft AS (
          UPDATE "PublicationDraft" draft
          SET "status" = 'expired'::"PublicationDraftStatus", "updatedAt" = ${input.now}
          FROM candidate, updated_command
          WHERE draft."id" = candidate."publicationDraftId"
          RETURNING draft."id"
        ), updated_legacy_draft AS (
          UPDATE "BinancePublicationDraft" draft
          SET "status" = 'expired'::"PublicationDraftStatus", "updatedAt" = ${input.now}
          FROM candidate, updated_command
          WHERE draft."id" = candidate."legacyDraftId"
          RETURNING draft."id"
        ), updated_approval AS (
          UPDATE "PublishApproval" approval
          SET "state" = 'expired'::"PublishApprovalState",
            "consumedAt" = ${input.now}, "updatedAt" = ${input.now}
          FROM candidate, updated_command
          WHERE approval."commandId" = candidate."commandId"
            AND approval."state" IN (
              'pending'::"PublishApprovalState", 'confirmation_required'::"PublishApprovalState"
            )
          RETURNING approval."id"
        )
        SELECT updated_command."id", candidate."draftId", updated_command."target",
          updated_command."state", updated_command."revision", updated_command."recipeHash",
          updated_command."expiresAt", updated_command."resultUrl", updated_command."failureReason",
          updated_command."updatedAt"
        FROM updated_command
        INNER JOIN candidate ON candidate."commandId" = updated_command."id"
        WHERE EXISTS (SELECT 1 FROM updated_draft) OR EXISTS (SELECT 1 FROM updated_legacy_draft)
      `;
      return commandRow(rows[0] as Record<string, unknown> | undefined);
    },

    async approve(input) {
      const rows = await database.$client`
        WITH candidate AS (
          SELECT command."id" AS "commandId", legacy_draft."id" AS "legacyDraftId",
            draft."id" AS "publicationDraftId", COALESCE(draft."id", legacy_draft."id") AS "draftId",
            command."target", command."revision", command."recipeHash", command."expiresAt"
          FROM "PublisherCommand" command
          LEFT JOIN "PublicationDraft" draft ON draft."id" = command."publicationDraftId"
          LEFT JOIN "BinancePublicationDraft" legacy_draft ON legacy_draft."id" = command."draftId"
          INNER JOIN "WorkspaceMember" member
            ON member."workspaceId" = COALESCE(draft."workspaceId", legacy_draft."workspaceId")
            AND member."userId" = ${input.actorUserId}
          INNER JOIN "PublisherDevice" device
            ON device."id" = command."deviceId"
            AND device."userId" = ${input.actorUserId}
            AND device."workspaceId" = COALESCE(draft."workspaceId", legacy_draft."workspaceId")
            AND device."status" = 'active'::"PublisherDeviceStatus"
          WHERE command."id" = ${input.commandId}
            AND command."revision" = ${input.revision}
            AND command."recipeHash" = ${input.recipeHash}
            AND command."state" = 'awaiting_review'::"PublisherCommandState"
            AND command."expiresAt" > ${input.now}
            AND CASE WHEN command."publicationDraftId" IS NOT NULL
              THEN draft."revision" ELSE legacy_draft."revision" END = command."revision"
            AND CASE WHEN command."publicationDraftId" IS NOT NULL
              THEN draft."recipeHash" ELSE legacy_draft."recipeHash" END = command."recipeHash"
            AND command."target" = CASE WHEN command."publicationDraftId" IS NOT NULL
              THEN draft."target" ELSE 'binance-square'::"PublicationTarget" END
            AND CASE WHEN command."publicationDraftId" IS NOT NULL
              THEN draft."status" ELSE legacy_draft."status" END = 'review_ready'::"PublicationDraftStatus"
            AND CASE WHEN command."publicationDraftId" IS NOT NULL
              THEN draft."expiresAt" ELSE legacy_draft."expiresAt" END > ${input.now}
          FOR UPDATE OF command
        ), updated_command AS (
          UPDATE "PublisherCommand" command
          SET "state" = 'approved'::"PublisherCommandState", "updatedAt" = ${input.now}
          FROM candidate WHERE command."id" = candidate."commandId"
          RETURNING command.*
        ), updated_draft AS (
          UPDATE "PublicationDraft" draft
          SET "status" = 'authorized'::"PublicationDraftStatus", "updatedAt" = ${input.now}
          FROM candidate, updated_command
          WHERE draft."id" = candidate."publicationDraftId"
          RETURNING draft."id"
        ), updated_legacy_draft AS (
          UPDATE "BinancePublicationDraft" draft
          SET "status" = 'authorized'::"PublicationDraftStatus", "updatedAt" = ${input.now}
          FROM candidate, updated_command WHERE draft."id" = candidate."legacyDraftId"
          RETURNING draft."id"
        ), inserted_approval AS (
          INSERT INTO "PublishApproval" (
            "id", "commandId", "draftId", "publicationDraftId", "userId", "approvedVia",
            "telegramUserId", "callbackTokenHash", "state", "revision", "recipeHash",
            "expiresAt", "consumedAt", "createdAt", "updatedAt"
          )
          SELECT ${input.approvalId}, candidate."commandId", candidate."legacyDraftId",
            candidate."publicationDraftId", ${input.actorUserId}, 'web'::"PublishApprovalVia",
            NULL, NULL, 'approved'::"PublishApprovalState", candidate."revision", candidate."recipeHash",
            candidate."expiresAt", ${input.now}, ${input.now}, ${input.now}
          FROM candidate
          INNER JOIN updated_command ON true
          WHERE EXISTS (SELECT 1 FROM updated_draft) OR EXISTS (SELECT 1 FROM updated_legacy_draft)
          RETURNING "commandId"
        )
        SELECT updated_command."id", candidate."draftId", updated_command."target",
          updated_command."state", updated_command."revision", updated_command."recipeHash",
          updated_command."expiresAt", updated_command."resultUrl", updated_command."failureReason",
          updated_command."updatedAt"
        FROM updated_command
        INNER JOIN candidate ON candidate."commandId" = updated_command."id"
        INNER JOIN inserted_approval ON inserted_approval."commandId" = updated_command."id"
      `;
      return commandRow(rows[0] as Record<string, unknown> | undefined);
    },
  };
}
