import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { AppDatabase } from '@/server/db/client';
import {
  binancePublicationDraft,
  publisherCommand,
  storageObject,
} from '@/server/db/schema';

import type {
  PublisherCommandRecord,
  PublisherCommandRepository,
} from './service';

export function createPublisherCommandRepository(
  database: AppDatabase,
): PublisherCommandRepository {
  return {
    async claimNext({ deviceId, now }) {
      const rows = await database.$client`
        WITH candidate AS (
          SELECT "id"
          FROM "PublisherCommand"
          WHERE "deviceId" = ${deviceId}
            AND "state" = 'queued'::"PublisherCommandState"
            AND "expiresAt" > ${now}
          ORDER BY "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "PublisherCommand" AS command
        SET
          "state" = 'claimed'::"PublisherCommandState",
          "claimedAt" = ${now},
          "updatedAt" = ${now}
        FROM candidate
        WHERE command."id" = candidate."id"
        RETURNING
          command."id", command."draftId", command."deviceId", command."state",
          command."revision", command."recipeHash", command."expiresAt"
      `;
      return (rows[0] as PublisherCommandRecord | undefined) ?? null;
    },

    async loadRecipe({ deviceId, commandId }) {
      const rows = await database
        .select({
          command: {
            id: publisherCommand.id,
            deviceId: publisherCommand.deviceId,
            state: publisherCommand.state,
            revision: publisherCommand.revision,
            recipeHash: publisherCommand.recipeHash,
          },
          draft: {
            id: binancePublicationDraft.id,
            articleId: binancePublicationDraft.articleId,
            revision: binancePublicationDraft.revision,
            expiresAt: binancePublicationDraft.expiresAt,
            title: binancePublicationDraft.title,
            markdown: binancePublicationDraft.markdown,
            cover: binancePublicationDraft.cover,
            orderedAssetIds: binancePublicationDraft.orderedAssetIds,
            workspaceId: binancePublicationDraft.workspaceId,
          },
        })
        .from(publisherCommand)
        .innerJoin(binancePublicationDraft, eq(binancePublicationDraft.id, publisherCommand.draftId))
        .where(and(
          eq(publisherCommand.id, commandId),
          eq(publisherCommand.deviceId, deviceId),
        ))
        .limit(1);
      const loaded = rows[0];
      if (!loaded) return null;

      const cover = loaded.draft.cover as {
        assetId: string;
        focalX: number;
        focalY: number;
        targetWidth: 1000;
        targetHeight: 400;
      };
      const orderedAssetIds = loaded.draft.orderedAssetIds as string[];
      const assetIds = [...new Set([cover.assetId, ...orderedAssetIds])];
      const assets = await database
        .select({
          id: storageObject.id,
          mimeType: storageObject.mimeType,
          sizeBytes: storageObject.sizeBytes,
          sha256: storageObject.sha256,
        })
        .from(storageObject)
        .where(and(
          eq(storageObject.workspaceId, loaded.draft.workspaceId),
          inArray(storageObject.id, assetIds),
          isNull(storageObject.deletedAt),
        ));

      return {
        command: loaded.command as {
          id: string;
          deviceId: string;
          state: PublisherCommandRecord['state'];
          revision: number;
          recipeHash: string;
        },
        recipe: {
          version: 1,
          draftId: loaded.draft.id,
          articleId: loaded.draft.articleId,
          revision: loaded.draft.revision,
          expiresAt: loaded.draft.expiresAt.toISOString(),
          title: loaded.draft.title,
          markdown: loaded.draft.markdown,
          cover,
          orderedAssetIds,
          assets,
        },
      };
    },

    async compareAndSwap(input) {
      const terminal = ['succeeded', 'failed', 'outcome_unknown', 'cancelled'].includes(input.to);
      const rows = await database.$client`
        WITH updated_command AS (
          UPDATE "PublisherCommand" AS command
          SET
            "state" = ${input.to}::"PublisherCommandState",
            "resultUrl" = COALESCE(${input.publishedUrl ?? null}, command."resultUrl"),
            "failureReason" = COALESCE(${input.failureReason ?? null}, command."failureReason"),
            "completedAt" = CASE WHEN ${terminal} THEN ${input.now} ELSE command."completedAt" END,
            "updatedAt" = ${input.now}
          WHERE command."id" = ${input.commandId}
            AND command."deviceId" = ${input.deviceId}
            AND command."revision" = ${input.revision}
            AND command."state" = ${input.from}::"PublisherCommandState"
            AND (${input.from === 'publishing'} OR command."expiresAt" > ${input.now})
          RETURNING command."id", command."draftId"
        ), updated_draft AS (
          UPDATE "BinancePublicationDraft" AS draft
          SET
            "status" = CASE ${input.to}
              WHEN 'awaiting_review' THEN 'review_ready'::"PublicationDraftStatus"
              WHEN 'awaiting_approval' THEN 'awaiting_approval'::"PublicationDraftStatus"
              WHEN 'approved' THEN 'authorized'::"PublicationDraftStatus"
              WHEN 'publishing' THEN 'publishing'::"PublicationDraftStatus"
              WHEN 'succeeded' THEN 'published'::"PublicationDraftStatus"
              WHEN 'failed' THEN 'failed'::"PublicationDraftStatus"
              WHEN 'outcome_unknown' THEN 'outcome_unknown'::"PublicationDraftStatus"
              WHEN 'cancelled' THEN 'cancelled'::"PublicationDraftStatus"
              ELSE draft."status"
            END,
            "publishedUrl" = COALESCE(${input.publishedUrl ?? null}, draft."publishedUrl"),
            "updatedAt" = ${input.now}
          FROM updated_command
          WHERE draft."id" = updated_command."draftId"
          RETURNING draft."id"
        )
        SELECT updated_command."id" FROM updated_command
        INNER JOIN updated_draft ON true
      `;
      return Boolean(rows[0]);
    },

    async loadStatus({ deviceId, commandId }) {
      const rows = await database.$client`
        SELECT "id", "draftId", "deviceId", "state", "revision", "recipeHash", "expiresAt"
        FROM "PublisherCommand"
        WHERE "id" = ${commandId}
          AND "deviceId" = ${deviceId}
        LIMIT 1
      `;
      return (rows[0] as PublisherCommandRecord | undefined) ?? null;
    },

    async abort(input) {
      const rows = await database.$client`
        WITH candidate AS (
          SELECT command."id", command."draftId"
          FROM "PublisherCommand" command
          INNER JOIN "BinancePublicationDraft" draft ON draft."id" = command."draftId"
          WHERE command."id" = ${input.commandId}
            AND command."deviceId" = ${input.deviceId}
            AND command."revision" = ${input.revision}
            AND command."expiresAt" > ${input.now}
            AND command."state" <> 'publishing'::"PublisherCommandState"
            AND command."state" IN (
              'claimed'::"PublisherCommandState",
              'awaiting_review'::"PublisherCommandState",
              'awaiting_approval'::"PublisherCommandState",
              'approved'::"PublisherCommandState"
            )
          FOR UPDATE OF command, draft
        ), updated_command AS (
          UPDATE "PublisherCommand" command
          SET
            "state" = 'cancelled'::"PublisherCommandState",
            "failureReason" = ${input.reasonCode},
            "completedAt" = ${input.now},
            "updatedAt" = ${input.now}
          FROM candidate
          WHERE command."id" = candidate."id"
          RETURNING command."id", command."draftId"
        ), updated_draft AS (
          UPDATE "BinancePublicationDraft" draft
          SET "status" = 'cancelled'::"PublicationDraftStatus", "updatedAt" = ${input.now}
          FROM updated_command
          WHERE draft."id" = updated_command."draftId"
          RETURNING draft."id"
        ), updated_approval AS (
          UPDATE "PublishApproval" approval
          SET
            "state" = 'cancelled'::"PublishApprovalState",
            "consumedAt" = ${input.now},
            "updatedAt" = ${input.now}
          FROM updated_command
          WHERE approval."commandId" = updated_command."id"
            AND approval."state" IN (
              'pending'::"PublishApprovalState",
              'confirmation_required'::"PublishApprovalState"
            )
          RETURNING approval."id"
        )
        SELECT updated_command."id" FROM updated_command
        INNER JOIN updated_draft ON true
      `;
      return Boolean(rows[0]);
    },
  };
}
