import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import type { AppDatabase } from '@/server/db/client';
import {
  articleCover,
  deckProject,
  publicationDraft,
  publisherDevice,
  storageObject,
  userQuota,
  workspaceMember,
} from '@/server/db/schema';
import { DEFAULT_USER_QUOTA } from '@/server/domain/quotas';

import type { PublicationPreparationContext, PublicationRepository } from './service';

export function createPublicationRepository(database: AppDatabase): PublicationRepository {
  return {
    async loadPreparationContext({ actorUserId, workspaceId, articleId, target }) {
      const draftRows = await database
        .select({
          id: publicationDraft.id,
          workspaceId: publicationDraft.workspaceId,
          articleId: publicationDraft.articleId,
          target: publicationDraft.target,
          revision: publicationDraft.revision,
          payload: publicationDraft.payload,
          expiresAt: publicationDraft.expiresAt,
          articleGenerationRevision: deckProject.generationRevision,
        })
        .from(publicationDraft)
        .innerJoin(deckProject, eq(deckProject.id, publicationDraft.articleId))
        .innerJoin(workspaceMember, and(
          eq(workspaceMember.workspaceId, publicationDraft.workspaceId),
          eq(workspaceMember.userId, actorUserId),
        ))
        .where(and(
          eq(publicationDraft.workspaceId, workspaceId),
          eq(publicationDraft.articleId, articleId),
          eq(publicationDraft.target, target),
          inArray(publicationDraft.status, ['draft', 'prepared']),
        ))
        .orderBy(desc(publicationDraft.updatedAt))
        .limit(1);
      const draft = draftRows[0];
      if (!draft) return null;

      const [quotaRows, deviceRows, coverRows] = await Promise.all([
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
        target === 'binance-square'
          ? database
            .select({ sourceAssetId: articleCover.sourceAssetId })
            .from(articleCover)
            .where(and(
              eq(articleCover.workspaceId, workspaceId),
              eq(articleCover.articleId, articleId),
              eq(articleCover.generationRevision, draft.articleGenerationRevision),
              eq(articleCover.status, 'generated'),
            ))
            .limit(1)
          : Promise.resolve([]),
      ]);

      const generatedCoverAssetId = coverRows[0]?.sourceAssetId ?? null;
      const payload = draft.payload as { orderedAssetIds?: unknown };
      const orderedAssetIds = Array.isArray(payload.orderedAssetIds)
        ? payload.orderedAssetIds.filter((id): id is string => typeof id === 'string')
        : [];
      const assetIds = [...new Set([
        ...(generatedCoverAssetId ? [generatedCoverAssetId] : []),
        ...orderedAssetIds,
      ])];
      const assets = assetIds.length === 0 ? [] : await database
        .select({
          id: storageObject.id,
          purpose: storageObject.purpose,
          mimeType: storageObject.mimeType,
          sizeBytes: storageObject.sizeBytes,
          sha256: storageObject.sha256,
        })
        .from(storageObject)
        .where(and(
          eq(storageObject.workspaceId, workspaceId),
          eq(storageObject.articleId, articleId),
          inArray(storageObject.id, assetIds),
          isNull(storageObject.deletedAt),
        ));

      return {
        draft: {
          id: draft.id,
          workspaceId: draft.workspaceId,
          articleId: draft.articleId,
          target: draft.target,
          revision: draft.revision,
          payload: draft.payload,
          expiresAt: draft.expiresAt,
        },
        assets,
        generatedCoverAssetId,
        quota: quotaRows[0] ?? DEFAULT_USER_QUOTA,
        device: deviceRows[0] ?? null,
      } as PublicationPreparationContext;
    },

    async commitPreparedPublication({
      actorUserId,
      workspaceId,
      target,
      expectedRevision,
      recipeHash,
      recipe,
      command,
    }) {
      // The draft status flips to 'queued' only when the command row actually
      // inserts; an idempotency-key conflict must leave the draft untouched,
      // otherwise it would be stuck 'queued' with no command to complete it.
      const [rows] = await database.$client.transaction((transaction) => [
        transaction`
          WITH candidate AS MATERIALIZED (
            SELECT draft."id", draft."target"
            FROM "PublicationDraft" AS draft
            WHERE draft."id" = ${command.draftId}
              AND draft."workspaceId" = ${workspaceId}
              AND draft."target" = ${target}::"PublicationTarget"
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
            FOR UPDATE
          ), inserted_command AS (
            INSERT INTO "PublisherCommand" (
              "id", "draftId", "publicationDraftId", "target", "deviceId", "state", "revision",
              "recipeHash", "idempotencyKey", "expiresAt", "createdAt", "updatedAt"
            )
            SELECT
              ${command.id}, NULL, candidate."id", candidate."target", ${command.deviceId},
              'queued'::"PublisherCommandState", ${command.revision}, ${command.recipeHash},
              ${`prepare:${target}:${command.draftId}:${command.revision}`}, ${command.expiresAt}, now(), now()
            FROM candidate
            ON CONFLICT ("idempotencyKey") DO NOTHING
            RETURNING "id", "publicationDraftId"
          ), updated_draft AS (
            UPDATE "PublicationDraft" AS draft
            SET
              "status" = 'queued'::"PublicationDraftStatus",
              "payload" = ${JSON.stringify(recipe.target === 'binance-square' ? {
                title: recipe.title,
                markdown: recipe.markdown,
                cover: recipe.cover,
                orderedAssetIds: recipe.orderedAssetIds,
              } : {
                text: recipe.text,
                orderedAssetIds: recipe.orderedAssetIds,
              })}::jsonb,
              "recipeHash" = ${recipeHash},
              "updatedAt" = now()
            FROM inserted_command
            WHERE draft."id" = inserted_command."publicationDraftId"
            RETURNING draft."id"
          )
          SELECT inserted_command."id"
          FROM inserted_command
          WHERE EXISTS (SELECT 1 FROM updated_draft)
        `,
      ], { isolationLevel: 'ReadCommitted' });
      return Boolean(rows[0]);
    },
  };
}
