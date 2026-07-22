import type { ImageGenerationStatus } from '@/lib/schemas';
import type { AppDatabase } from '@/server/db/client';

import type { ArticleCoverRepository, ArticleCoverRecord } from './service';

function firstCover(value: unknown): ArticleCoverRecord | null {
  if (!Array.isArray(value)) throw new Error('Article cover query returned invalid data.');
  const row = value[0];
  if (row === undefined) return null;
  if (!row || typeof row !== 'object') throw new Error('Article cover query returned invalid data.');
  return row as ArticleCoverRecord;
}

export function createArticleCoverRepository(database: AppDatabase): ArticleCoverRepository {
  return {
    async initialize(input) {
      const result = await database.$client`
        INSERT INTO "ArticleCover" (
          "id", "workspaceId", "articleId", "generationRevision", "style", "styleMode",
          "prompt", "status", "sourceAssetId", "error", "createdAt", "updatedAt"
        )
        SELECT
          ${input.id}, deck."workspaceId", deck."id", ${input.generationRevision},
          ${input.style}, ${input.styleMode}, ${input.prompt},
          'pending'::"SlideImageStatus", NULL, NULL, ${input.now}, ${input.now}
        FROM "DeckProject" AS deck
        WHERE deck."id" = ${input.articleId}
          AND deck."workspaceId" = ${input.workspaceId}
          AND deck."generationRevision" = ${input.generationRevision}
        ON CONFLICT ("articleId") DO UPDATE SET
          "generationRevision" = EXCLUDED."generationRevision",
          "style" = EXCLUDED."style",
          "styleMode" = EXCLUDED."styleMode",
          "prompt" = EXCLUDED."prompt",
          "status" = 'pending'::"SlideImageStatus",
          "sourceAssetId" = NULL,
          "error" = NULL,
          "updatedAt" = EXCLUDED."updatedAt"
        WHERE "ArticleCover"."workspaceId" = EXCLUDED."workspaceId"
          AND EXISTS (
            SELECT 1 FROM "DeckProject" AS current_deck
            WHERE current_deck."id" = EXCLUDED."articleId"
              AND current_deck."workspaceId" = EXCLUDED."workspaceId"
              AND current_deck."generationRevision" = EXCLUDED."generationRevision"
          )
        RETURNING *, NULL::text AS "sourceMimeType"
      `;
      return firstCover(result);
    },

    async markGenerated(input) {
      const result = await database.$client`
        UPDATE "ArticleCover" AS cover
        SET
          "status" = 'generated'::"SlideImageStatus",
          "sourceAssetId" = asset."id",
          "error" = NULL,
          "updatedAt" = ${input.now}
        FROM "DeckProject" AS deck, "StorageObject" AS asset
        WHERE cover."articleId" = ${input.articleId}
          AND cover."workspaceId" = ${input.workspaceId}
          AND cover."generationRevision" = ${input.generationRevision}
          AND deck."id" = cover."articleId"
          AND deck."workspaceId" = cover."workspaceId"
          AND deck."generationRevision" = cover."generationRevision"
          AND asset."id" = ${input.sourceAssetId}
          AND asset."workspaceId" = cover."workspaceId"
          AND asset."articleId" = cover."articleId"
          AND asset."purpose" = 'cover_image'::"StorageObjectPurpose"
          AND asset."deletedAt" IS NULL
        RETURNING cover.*, asset."mimeType" AS "sourceMimeType"
      `;
      return firstCover(result);
    },

    async markFailed(input) {
      const result = await database.$client`
        UPDATE "ArticleCover" AS cover
        SET
          "status" = 'failed'::"SlideImageStatus",
          "sourceAssetId" = NULL,
          "error" = ${input.error},
          "updatedAt" = ${input.now}
        FROM "DeckProject" AS deck
        WHERE cover."articleId" = ${input.articleId}
          AND cover."workspaceId" = ${input.workspaceId}
          AND cover."generationRevision" = ${input.generationRevision}
          AND deck."id" = cover."articleId"
          AND deck."workspaceId" = cover."workspaceId"
          AND deck."generationRevision" = cover."generationRevision"
        RETURNING cover.*, NULL::text AS "sourceMimeType"
      `;
      return firstCover(result);
    },

    async findByArticle(input) {
      const result = await database.$client`
        SELECT cover.*, asset."mimeType" AS "sourceMimeType"
        FROM "ArticleCover" AS cover
        INNER JOIN "DeckProject" AS deck ON deck."id" = cover."articleId"
        LEFT JOIN "StorageObject" AS asset
          ON asset."id" = cover."sourceAssetId"
          AND asset."workspaceId" = cover."workspaceId"
          AND asset."articleId" = cover."articleId"
          AND asset."purpose" = 'cover_image'::"StorageObjectPurpose"
          AND asset."deletedAt" IS NULL
        WHERE cover."articleId" = ${input.articleId}
          AND cover."workspaceId" = ${input.workspaceId}
          AND deck."workspaceId" = cover."workspaceId"
        LIMIT 1
      `;
      return firstCover(result);
    },
  };
}

export type ArticleCoverStatus = ImageGenerationStatus;
