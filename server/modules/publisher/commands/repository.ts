import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { AppDatabase } from '@/server/db/client';
import {
  binancePublicationDraft,
  publicationDraft,
  publisherCommand,
  storageObject,
} from '@/server/db/schema';
import type { PublicationTarget } from '@/server/domain/publication-recipe';

import type { PublisherCommandRecord, PublisherCommandRepository } from './service';

type GenericRecipeRow = {
  command: {
    id: string;
    deviceId: string | null;
    state: PublisherCommandRecord['state'];
    revision: number;
    recipeHash: string;
    target: PublicationTarget;
  };
  draft: {
    id: string;
    articleId: string;
    revision: number;
    expiresAt: Date;
    target: PublicationTarget;
    payload: unknown;
    workspaceId: string;
  };
};

export function createPublisherCommandRepository(database: AppDatabase): PublisherCommandRepository {
  return {
    async claimNext({ deviceId, now }) {
      const rows = await database.$client`
        WITH expired_commands AS (
          UPDATE "PublisherCommand" command
          SET "state" = 'expired'::"PublisherCommandState",
            "completedAt" = ${now}, "updatedAt" = ${now}
          WHERE command."deviceId" = ${deviceId}
            AND command."expiresAt" <= ${now}
            AND command."state" IN (
              'queued'::"PublisherCommandState", 'claimed'::"PublisherCommandState",
              'awaiting_review'::"PublisherCommandState", 'awaiting_approval'::"PublisherCommandState",
              'approved'::"PublisherCommandState"
            )
          RETURNING command."id", command."draftId", command."publicationDraftId"
        ), expired_drafts AS (
          UPDATE "PublicationDraft" draft
          SET "status" = 'expired'::"PublicationDraftStatus", "updatedAt" = ${now}
          FROM expired_commands
          WHERE draft."id" = expired_commands."publicationDraftId"
          RETURNING draft."id"
        ), expired_legacy_drafts AS (
          UPDATE "BinancePublicationDraft" draft
          SET "status" = 'expired'::"PublicationDraftStatus", "updatedAt" = ${now}
          FROM expired_commands
          WHERE draft."id" = expired_commands."draftId"
          RETURNING draft."id"
        ), expired_approvals AS (
          UPDATE "PublishApproval" approval
          SET "state" = 'expired'::"PublishApprovalState",
            "consumedAt" = ${now}, "updatedAt" = ${now}
          FROM expired_commands
          WHERE approval."commandId" = expired_commands."id"
            AND approval."state" IN (
              'pending'::"PublishApprovalState", 'confirmation_required'::"PublishApprovalState"
            )
          RETURNING approval."id"
        ), candidate AS (
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
          command."id", COALESCE(command."publicationDraftId", command."draftId") AS "draftId",
          command."deviceId", command."target", command."state", command."revision",
          command."recipeHash", command."expiresAt"
      `;
      return (rows[0] as PublisherCommandRecord | undefined) ?? null;
    },

    async loadRecipe({ deviceId, commandId }) {
      const genericRows = await database
        .select({
          command: {
            id: publisherCommand.id,
            deviceId: publisherCommand.deviceId,
            state: publisherCommand.state,
            revision: publisherCommand.revision,
            recipeHash: publisherCommand.recipeHash,
            target: publisherCommand.target,
          },
          draft: {
            id: publicationDraft.id,
            articleId: publicationDraft.articleId,
            revision: publicationDraft.revision,
            expiresAt: publicationDraft.expiresAt,
            target: publicationDraft.target,
            payload: publicationDraft.payload,
            workspaceId: publicationDraft.workspaceId,
          },
        })
        .from(publisherCommand)
        .innerJoin(publicationDraft, eq(publicationDraft.id, publisherCommand.publicationDraftId))
        .where(and(eq(publisherCommand.id, commandId), eq(publisherCommand.deviceId, deviceId)))
        .limit(1);
      const generic = genericRows[0] as GenericRecipeRow | undefined;
      if (generic) {
        const payload = generic.draft.payload as {
          title?: unknown;
          markdown?: unknown;
          cover?: { assetId?: unknown };
          text?: unknown;
          orderedAssetIds?: unknown;
        };
        const orderedAssetIds = Array.isArray(payload.orderedAssetIds)
          ? payload.orderedAssetIds.filter((id): id is string => typeof id === 'string')
          : [];
        const coverId = generic.draft.target === 'binance-square'
          && typeof payload.cover?.assetId === 'string'
          ? payload.cover.assetId
          : null;
        const assetIds = [...new Set([...(coverId ? [coverId] : []), ...orderedAssetIds])];
        const assetRows = assetIds.length === 0 ? [] : await database
          .select({
            id: storageObject.id,
            mimeType: storageObject.mimeType,
            sizeBytes: storageObject.sizeBytes,
            sha256: storageObject.sha256,
          })
          .from(storageObject)
          .where(and(
            eq(storageObject.workspaceId, generic.draft.workspaceId),
            eq(storageObject.articleId, generic.draft.articleId),
            inArray(storageObject.id, assetIds),
            isNull(storageObject.deletedAt),
          ));
        const assetsById = new Map(assetRows.map((asset) => [asset.id, asset]));
        const assets = assetIds
          .map((assetId) => assetsById.get(assetId))
          .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
        const common = {
          version: 2 as const,
          target: generic.draft.target,
          draftId: generic.draft.id,
          articleId: generic.draft.articleId,
          revision: generic.draft.revision,
          expiresAt: generic.draft.expiresAt.toISOString(),
          orderedAssetIds,
          assets,
        };
        return {
          command: generic.command,
          recipe: generic.draft.target === 'binance-square'
            ? {
              ...common,
              target: 'binance-square' as const,
              title: payload.title,
              markdown: payload.markdown,
              cover: payload.cover,
            }
            : {
              ...common,
              target: 'x' as const,
              text: payload.text,
            },
        };
      }

      // Compatibility for commands created before PublicationDraft V2 was deployed.
      const legacyRows = await database
        .select({
          command: {
            id: publisherCommand.id,
            deviceId: publisherCommand.deviceId,
            state: publisherCommand.state,
            revision: publisherCommand.revision,
            recipeHash: publisherCommand.recipeHash,
            target: publisherCommand.target,
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
        .where(and(eq(publisherCommand.id, commandId), eq(publisherCommand.deviceId, deviceId)))
        .limit(1);
      const legacy = legacyRows[0];
      if (!legacy) return null;
      const cover = legacy.draft.cover as { assetId: string };
      const orderedAssetIds = legacy.draft.orderedAssetIds as string[];
      const assetIds = [...new Set([cover.assetId, ...orderedAssetIds])];
      const assetRows = await database
        .select({
          id: storageObject.id,
          mimeType: storageObject.mimeType,
          sizeBytes: storageObject.sizeBytes,
          sha256: storageObject.sha256,
        })
        .from(storageObject)
        .where(and(
          eq(storageObject.workspaceId, legacy.draft.workspaceId),
          inArray(storageObject.id, assetIds),
          isNull(storageObject.deletedAt),
        ));
      const assetsById = new Map(assetRows.map((asset) => [asset.id, asset]));
      const assets = assetIds
        .map((assetId) => assetsById.get(assetId))
        .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
      return {
        command: legacy.command,
        recipe: {
          version: 1,
          draftId: legacy.draft.id,
          articleId: legacy.draft.articleId,
          revision: legacy.draft.revision,
          expiresAt: legacy.draft.expiresAt.toISOString(),
          title: legacy.draft.title,
          markdown: legacy.draft.markdown,
          cover,
          orderedAssetIds,
          assets,
        },
      };
    },

    async compareAndSwap(input) {
      const terminal = ['succeeded', 'failed', 'outcome_unknown', 'cancelled', 'expired'].includes(input.to);
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
            AND (${input.from === 'publishing' || input.to === 'expired'} OR command."expiresAt" > ${input.now})
          RETURNING command."id", command."draftId", command."publicationDraftId"
        ), updated_draft AS (
          UPDATE "PublicationDraft" AS draft
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
              WHEN 'expired' THEN 'expired'::"PublicationDraftStatus"
              ELSE draft."status"
            END,
            "publishedUrl" = COALESCE(${input.publishedUrl ?? null}, draft."publishedUrl"),
            "updatedAt" = ${input.now}
          FROM updated_command
          WHERE draft."id" = COALESCE(updated_command."publicationDraftId", updated_command."draftId")
          RETURNING draft."id"
        ), updated_legacy_draft AS (
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
              WHEN 'expired' THEN 'expired'::"PublicationDraftStatus"
              ELSE draft."status"
            END,
            "publishedUrl" = COALESCE(${input.publishedUrl ?? null}, draft."publishedUrl"),
            "updatedAt" = ${input.now}
          FROM updated_command
          WHERE draft."id" = updated_command."draftId"
          RETURNING draft."id"
        ), updated_approval AS (
          UPDATE "PublishApproval" approval
          SET "state" = 'expired'::"PublishApprovalState",
            "consumedAt" = ${input.now}, "updatedAt" = ${input.now}
          FROM updated_command
          WHERE ${input.to === 'expired'}
            AND approval."commandId" = updated_command."id"
            AND approval."state" IN (
              'pending'::"PublishApprovalState", 'confirmation_required'::"PublishApprovalState"
            )
          RETURNING approval."id"
        )
        SELECT updated_command."id" FROM updated_command
        WHERE EXISTS (SELECT 1 FROM updated_draft)
           OR EXISTS (SELECT 1 FROM updated_legacy_draft)
      `;
      return Boolean(rows[0]);
    },

    async loadStatus({ deviceId, commandId }) {
      const rows = await database.$client`
        SELECT "id", COALESCE("publicationDraftId", "draftId") AS "draftId", "deviceId",
          "target", "state", "revision", "recipeHash", "expiresAt"
        FROM "PublisherCommand"
        WHERE "id" = ${commandId} AND "deviceId" = ${deviceId}
        LIMIT 1
      `;
      return (rows[0] as PublisherCommandRecord | undefined) ?? null;
    },

    async abort(input) {
      const rows = await database.$client`
        WITH candidate AS (
          SELECT command."id", command."draftId", command."publicationDraftId"
          FROM "PublisherCommand" command
          WHERE command."id" = ${input.commandId}
            AND command."deviceId" = ${input.deviceId}
            AND command."revision" = ${input.revision}
            AND command."expiresAt" > ${input.now}
            AND command."state" <> 'publishing'::"PublisherCommandState"
            AND command."state" IN (
              'claimed'::"PublisherCommandState", 'awaiting_review'::"PublisherCommandState",
              'awaiting_approval'::"PublisherCommandState", 'approved'::"PublisherCommandState"
            )
          FOR UPDATE OF command
        ), updated_command AS (
          UPDATE "PublisherCommand" command
          SET "state" = 'cancelled'::"PublisherCommandState",
            "failureReason" = ${input.reasonCode}, "completedAt" = ${input.now}, "updatedAt" = ${input.now}
          FROM candidate
          WHERE command."id" = candidate."id"
          RETURNING command."id", command."draftId", command."publicationDraftId"
        ), updated_draft AS (
          UPDATE "PublicationDraft" draft
          SET "status" = 'cancelled'::"PublicationDraftStatus", "updatedAt" = ${input.now}
          FROM updated_command
          WHERE draft."id" = COALESCE(updated_command."publicationDraftId", updated_command."draftId")
          RETURNING draft."id"
        ), updated_legacy_draft AS (
          UPDATE "BinancePublicationDraft" draft
          SET "status" = 'cancelled'::"PublicationDraftStatus", "updatedAt" = ${input.now}
          FROM updated_command WHERE draft."id" = updated_command."draftId"
          RETURNING draft."id"
        ), updated_approval AS (
          UPDATE "PublishApproval" approval
          SET "state" = 'cancelled'::"PublishApprovalState", "consumedAt" = ${input.now}, "updatedAt" = ${input.now}
          FROM updated_command
          WHERE approval."commandId" = updated_command."id"
            AND approval."state" IN ('pending'::"PublishApprovalState", 'confirmation_required'::"PublishApprovalState")
          RETURNING approval."id"
        )
        SELECT updated_command."id" FROM updated_command
        WHERE EXISTS (SELECT 1 FROM updated_draft)
           OR EXISTS (SELECT 1 FROM updated_legacy_draft)
      `;
      return Boolean(rows[0]);
    },
  };
}
