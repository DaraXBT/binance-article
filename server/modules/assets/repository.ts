import type { AppDatabase } from '@/server/db/client';

import type {
  ArticleAssetMetadata,
  ArticleAssetRepository,
  ReplacedArticleAsset,
} from './service';

export function createArticleAssetRepository(database: AppDatabase): ArticleAssetRepository {
  return {
    async replaceSlideAsset(input): Promise<ReplacedArticleAsset | null> {
      const [, result] = await database.$client.transaction((transaction) => [
        transaction`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${input.slideKeyPrefix}, 7419283)
          )
        `,
        transaction`
          WITH article AS MATERIALIZED (
          SELECT article."id"
          FROM "DeckProject" AS article
          WHERE article."id" = ${input.articleId}
            AND article."workspaceId" = ${input.workspaceId}
        ), retired AS (
          UPDATE "StorageObject" AS asset
          SET "deletedAt" = ${input.now}
          FROM article
          WHERE asset."workspaceId" = ${input.workspaceId}
            AND asset."articleId" = article."id"
            AND asset."purpose" = 'slide_image'::"StorageObjectPurpose"
            AND asset."deletedAt" IS NULL
            AND asset."r2Key" LIKE ${input.slideKeyPrefix} || '%'
            AND asset."r2Key" <> ${input.r2Key}
          RETURNING asset."r2Key"
        ), inserted AS (
          INSERT INTO "StorageObject" (
            "id", "workspaceId", "articleId", "r2Key", "purpose", "mimeType",
            "sizeBytes", "sha256", "deletedAt", "createdAt"
          )
          SELECT
            ${input.assetId}, ${input.workspaceId}, article."id", ${input.r2Key},
            'slide_image'::"StorageObjectPurpose", ${input.mimeType}, ${input.sizeBytes},
            ${input.sha256}, NULL, ${input.now}
          FROM article
          RETURNING "id"
        )
        SELECT
          inserted."id" AS "assetId",
          COALESCE((SELECT jsonb_agg(retired."r2Key") FROM retired), '[]'::jsonb)
            AS "retiredR2Keys"
          FROM inserted
        `,
      ], { isolationLevel: 'ReadCommitted' });
      const row = (result as Array<{ assetId?: unknown; retiredR2Keys?: unknown }>)[0];
      if (!row) return null;
      if (
        typeof row.assetId !== 'string' || !Array.isArray(row.retiredR2Keys) ||
        !row.retiredR2Keys.every((key): key is string => typeof key === 'string')
      ) {
        throw new Error('Article asset metadata query returned invalid data.');
      }
      return { assetId: row.assetId, retiredR2Keys: row.retiredR2Keys };
    },

    async authorizeAsset(input): Promise<ArticleAssetMetadata | null> {
      const result = await database.$client`
        SELECT
          asset."r2Key", asset."mimeType", asset."sizeBytes"::integer AS "sizeBytes",
          asset."sha256"
        FROM "StorageObject" AS asset
        WHERE asset."id" = ${input.assetId}
          AND asset."workspaceId" = ${input.workspaceId}
          AND asset."articleId" = ${input.articleId}
          AND asset."purpose" = 'slide_image'::"StorageObjectPurpose"
          AND asset."deletedAt" IS NULL
        LIMIT 1
      `;
      const row = (result as Array<Record<string, unknown>>)[0];
      if (!row) return null;
      if (
        typeof row.r2Key !== 'string' ||
        (row.mimeType !== 'image/jpeg' && row.mimeType !== 'image/png' && row.mimeType !== 'image/webp') ||
        !Number.isSafeInteger(Number(row.sizeBytes)) ||
        typeof row.sha256 !== 'string'
      ) {
        throw new Error('Article asset metadata query returned invalid data.');
      }
      return {
        r2Key: row.r2Key,
        mimeType: row.mimeType,
        sizeBytes: Number(row.sizeBytes),
        sha256: row.sha256,
      };
    },
  };
}
