import { and, eq } from 'drizzle-orm';

import type { AppDatabase } from '@/server/db/client';
import { binancePublicationDraft, workspaceMember } from '@/server/db/schema';

import type { BinanceDraftRepository, BinanceDraftRecord } from './draft-service';

export function createBinanceDraftRepository(
  database: AppDatabase,
): BinanceDraftRepository {
  return {
    async getDraft({ actorUserId, workspaceId, articleId }) {
      const rows = await database
        .select({
          id: binancePublicationDraft.id,
          workspaceId: binancePublicationDraft.workspaceId,
          articleId: binancePublicationDraft.articleId,
          revision: binancePublicationDraft.revision,
          status: binancePublicationDraft.status,
          title: binancePublicationDraft.title,
          markdown: binancePublicationDraft.markdown,
          cover: binancePublicationDraft.cover,
          orderedAssetIds: binancePublicationDraft.orderedAssetIds,
          expiresAt: binancePublicationDraft.expiresAt,
          publishedUrl: binancePublicationDraft.publishedUrl,
          updatedAt: binancePublicationDraft.updatedAt,
        })
        .from(binancePublicationDraft)
        .innerJoin(workspaceMember, and(
          eq(workspaceMember.workspaceId, binancePublicationDraft.workspaceId),
          eq(workspaceMember.userId, actorUserId),
        ))
        .where(and(
          eq(binancePublicationDraft.workspaceId, workspaceId),
          eq(binancePublicationDraft.articleId, articleId),
        ))
        .limit(1);
      return (rows[0] as BinanceDraftRecord | undefined) ?? null;
    },

    async saveDraft(input) {
      const [rows] = await database.$client.transaction((transaction) => [
        transaction`
          INSERT INTO "BinancePublicationDraft" (
            "id", "workspaceId", "articleId", "createdByUserId", "version", "revision",
            "status", "title", "markdown", "cover", "orderedAssetIds", "expiresAt",
            "createdAt", "updatedAt"
          )
          SELECT
            ${input.draftId}, ${input.workspaceId}, ${input.articleId}, ${input.actorUserId},
            1, 1, 'draft'::"PublicationDraftStatus", ${input.title}, ${input.markdown},
            ${JSON.stringify(input.cover)}::jsonb, ${JSON.stringify(input.orderedAssetIds)}::jsonb,
            ${input.expiresAt}, ${input.now}, ${input.now}
          FROM "DeckProject" article
          WHERE article."id" = ${input.articleId}
            AND article."workspaceId" = ${input.workspaceId}
            AND ${input.expectedRevision} = 0
            AND EXISTS (
              SELECT 1 FROM "WorkspaceMember" member
              WHERE member."workspaceId" = article."workspaceId"
                AND member."userId" = ${input.actorUserId}
            )
          ON CONFLICT ("workspaceId", "articleId") DO UPDATE
          SET
            "revision" = "BinancePublicationDraft"."revision" + 1,
            "status" = 'draft'::"PublicationDraftStatus",
            "title" = EXCLUDED."title",
            "markdown" = EXCLUDED."markdown",
            "cover" = EXCLUDED."cover",
            "orderedAssetIds" = EXCLUDED."orderedAssetIds",
            "recipeHash" = NULL,
            "expiresAt" = EXCLUDED."expiresAt",
            "publishedUrl" = NULL,
            "updatedAt" = EXCLUDED."updatedAt"
          WHERE "BinancePublicationDraft"."revision" = ${input.expectedRevision}
            AND "BinancePublicationDraft"."status" <> 'publishing'::"PublicationDraftStatus"
            AND EXISTS (
              SELECT 1 FROM "WorkspaceMember" member
              WHERE member."workspaceId" = "BinancePublicationDraft"."workspaceId"
                AND member."userId" = ${input.actorUserId}
            )
          RETURNING
            "id", "workspaceId", "articleId", "revision", "status", "title", "markdown",
            "cover", "orderedAssetIds", "expiresAt", "publishedUrl", "updatedAt"
        `,
      ], { isolationLevel: 'ReadCommitted' });

      return (rows[0] as BinanceDraftRecord | undefined) ?? null;
    },
  };
}
