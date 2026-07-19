import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import type { AppDatabase } from '@/server/db/client';
import {
  binancePublicationDraft,
  publisherDevice,
  storageObject,
  userQuota,
  workspaceMember,
} from '@/server/db/schema';
import { DEFAULT_USER_QUOTA } from '@/server/domain/quotas';

import type {
  BinancePreparationContext,
  BinancePublicationRepository,
} from './service';

export function createBinancePublicationRepository(
  database: AppDatabase,
): BinancePublicationRepository {
  return {
    async loadPreparationContext({ actorUserId, workspaceId, articleId }) {
      const draftRows = await database
        .select({
          id: binancePublicationDraft.id,
          workspaceId: binancePublicationDraft.workspaceId,
          articleId: binancePublicationDraft.articleId,
          revision: binancePublicationDraft.revision,
          title: binancePublicationDraft.title,
          markdown: binancePublicationDraft.markdown,
          cover: binancePublicationDraft.cover,
          orderedAssetIds: binancePublicationDraft.orderedAssetIds,
          expiresAt: binancePublicationDraft.expiresAt,
        })
        .from(binancePublicationDraft)
        .innerJoin(workspaceMember, and(
          eq(workspaceMember.workspaceId, binancePublicationDraft.workspaceId),
          eq(workspaceMember.userId, actorUserId),
        ))
        .where(and(
          eq(binancePublicationDraft.workspaceId, workspaceId),
          eq(binancePublicationDraft.articleId, articleId),
          inArray(binancePublicationDraft.status, ['draft', 'prepared']),
        ))
        .orderBy(desc(binancePublicationDraft.updatedAt))
        .limit(1);
      const draft = draftRows[0];
      if (!draft) return null;

      const [quotaRows, deviceRows] = await Promise.all([
        database
          .select({
            articlesPerMonth: userQuota.articlesPerMonth,
            imagesPerMonth: userQuota.imagesPerMonth,
            maxSlidesPerArticle: userQuota.maxSlidesPerArticle,
            publishingEnabled: userQuota.publishingEnabled,
          })
          .from(userQuota)
          .where(eq(userQuota.userId, actorUserId))
          .limit(1),
        database
          .select({
            id: publisherDevice.id,
            status: publisherDevice.status,
            lastSeenAt: publisherDevice.lastSeenAt,
          })
          .from(publisherDevice)
          .where(and(
            eq(publisherDevice.userId, actorUserId),
            eq(publisherDevice.workspaceId, workspaceId),
            eq(publisherDevice.status, 'active'),
          ))
          .orderBy(desc(publisherDevice.lastSeenAt))
          .limit(1),
      ]);

      const cover = draft.cover as BinancePreparationContext['draft']['cover'];
      const orderedAssetIds = draft.orderedAssetIds as string[];
      const assetIds = [...new Set([cover.assetId, ...orderedAssetIds])];
      const assets = assetIds.length === 0 ? [] : await database
        .select({
          id: storageObject.id,
          mimeType: storageObject.mimeType,
          sizeBytes: storageObject.sizeBytes,
          sha256: storageObject.sha256,
        })
        .from(storageObject)
        .where(and(
          eq(storageObject.workspaceId, workspaceId),
          inArray(storageObject.id, assetIds),
          isNull(storageObject.deletedAt),
        ));

      return {
        draft: { ...draft, cover, orderedAssetIds },
        assets,
        quota: quotaRows[0] ?? DEFAULT_USER_QUOTA,
        device: deviceRows[0] ?? null,
      } as BinancePreparationContext;
    },

    async commitPreparedPublication({
      actorUserId,
      workspaceId,
      expectedRevision,
      recipeHash,
      command,
    }) {
      const [rows] = await database.$client.transaction((transaction) => [
        transaction`
          WITH updated_draft AS (
            UPDATE "BinancePublicationDraft" AS draft
            SET
              "status" = 'queued'::"PublicationDraftStatus",
              "recipeHash" = ${recipeHash},
              "updatedAt" = now()
            WHERE draft."id" = ${command.draftId}
              AND draft."workspaceId" = ${workspaceId}
              AND draft."revision" = ${expectedRevision}
              AND draft."status" IN ('draft', 'prepared')
              AND draft."expiresAt" > now()
              AND EXISTS (
                SELECT 1 FROM "WorkspaceMember" member
                WHERE member."workspaceId" = draft."workspaceId"
                  AND member."userId" = ${actorUserId}
              )
              AND EXISTS (
                SELECT 1 FROM "PublisherDevice" device
                WHERE device."id" = ${command.deviceId}
                  AND device."workspaceId" = draft."workspaceId"
                  AND device."userId" = ${actorUserId}
                  AND device."status" = 'active'
              )
            RETURNING draft."id"
          )
          INSERT INTO "PublisherCommand" (
            "id", "draftId", "deviceId", "state", "revision", "recipeHash",
            "idempotencyKey", "expiresAt", "createdAt", "updatedAt"
          )
          SELECT
            ${command.id}, updated_draft."id", ${command.deviceId},
            'queued'::"PublisherCommandState", ${command.revision}, ${command.recipeHash},
            ${`prepare:${command.draftId}:${command.revision}`}, ${command.expiresAt}, now(), now()
          FROM updated_draft
          ON CONFLICT ("idempotencyKey") DO NOTHING
          RETURNING "id"
        `,
      ], { isolationLevel: 'ReadCommitted' });

      return Boolean(rows[0]);
    },
  };
}
