import type { AppDatabase } from '@/server/db/client';

import type { PublisherAssetRepository } from './service';

export function createPublisherAssetRepository(
  database: AppDatabase,
): PublisherAssetRepository {
  return {
    async authorizeAsset({ deviceId, commandId, assetId }) {
      const rows = await database.$client`
        SELECT
          asset."r2Key",
          asset."mimeType",
          asset."sizeBytes"::int AS "sizeBytes",
          asset."sha256"
        FROM "PublisherCommand" command
        LEFT JOIN "PublicationDraft" draft ON draft."id" = command."publicationDraftId"
        LEFT JOIN "BinancePublicationDraft" legacy_draft ON legacy_draft."id" = command."draftId"
        INNER JOIN "StorageObject" asset
          ON asset."id" = ${assetId}
          AND asset."workspaceId" = COALESCE(draft."workspaceId", legacy_draft."workspaceId")
          AND asset."deletedAt" IS NULL
        WHERE command."id" = ${commandId}
          AND command."deviceId" = ${deviceId}
          AND command."expiresAt" > now()
          AND COALESCE(draft."expiresAt", legacy_draft."expiresAt") > now()
          AND command."state" IN (
            'claimed'::"PublisherCommandState",
            'awaiting_review'::"PublisherCommandState",
            'awaiting_approval'::"PublisherCommandState",
            'approved'::"PublisherCommandState",
            'publishing'::"PublisherCommandState"
          )
          AND (
            draft."payload"->'cover'->>'assetId' = ${assetId}
            OR draft."payload"->'orderedAssetIds' ? ${assetId}
            OR legacy_draft."cover"->>'assetId' = ${assetId}
            OR legacy_draft."orderedAssetIds" ? ${assetId}
          )
        LIMIT 1
      `;
      if (!rows[0]) return null;
      return {
        r2Key: String(rows[0].r2Key),
        mimeType: rows[0].mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
        sizeBytes: Number(rows[0].sizeBytes),
        sha256: String(rows[0].sha256),
      };
    },
  };
}
