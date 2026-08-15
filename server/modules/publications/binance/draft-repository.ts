import type { AppDatabase } from '@/server/db/client';

import { createPublicationDraftRepository } from '../draft-repository';
import type { BinanceDraftRepository, BinanceDraftRecord } from './draft-service';

function flatten(record: Awaited<ReturnType<ReturnType<typeof createPublicationDraftRepository>['getDraft']>>) {
  if (!record) return null;
  return { ...record, ...(record.payload as Record<string, unknown>) } as BinanceDraftRecord;
}

export function createBinanceDraftRepository(database: AppDatabase): BinanceDraftRepository {
  const repository = createPublicationDraftRepository(database);
  return {
    async getDraft(input) {
      return flatten(await repository.getDraft({
        ...input,
        target: 'binance-square',
        kind: 'article',
      }));
    },
    async saveDraft(input) {
      return flatten(await repository.saveDraft({
        actorUserId: input.actorUserId,
        workspaceId: input.workspaceId,
        articleId: input.articleId,
        target: 'binance-square',
        kind: 'article',
        draftId: input.draftId,
        expectedRevision: input.expectedRevision,
        payload: {
          title: input.title,
          markdown: input.markdown,
          ...(input.cover.assetId ? { cover: { ...input.cover, assetId: input.cover.assetId } } : {}),
          orderedAssetIds: input.orderedAssetIds,
        },
        expiresAt: input.expiresAt,
        now: input.now,
      }));
    },
  };
}
