import { describe, expect, it, vi } from 'vitest';

import {
  getArticleCover,
  initializeArticleCover,
  markArticleCoverGenerated,
  type ArticleCoverRecord,
} from './service';

const now = new Date('2026-07-22T00:00:00.000Z');

function record(overrides: Partial<ArticleCoverRecord> = {}): ArticleCoverRecord {
  return {
    id: 'cover_1',
    workspaceId: 'workspace_1',
    articleId: 'article_1',
    generationRevision: 2,
    style: 'binance-master',
    styleMode: 'scene',
    prompt: 'cover prompt',
    status: 'pending',
    sourceAssetId: null,
    sourceMimeType: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('article cover service', () => {
  it('initializes a revision-bound Master cover', async () => {
    const repository = {
      initialize: vi.fn(async () => record()),
      markGenerated: vi.fn(),
      markFailed: vi.fn(),
      findByArticle: vi.fn(),
    };
    await expect(initializeArticleCover({
      repository,
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      generationRevision: 2,
      style: 'binance-master',
      styleMode: 'scene',
      prompt: 'cover prompt',
      coverId: 'cover_1',
      now,
    })).resolves.toMatchObject({ status: 'pending', styleMode: 'scene' });
    expect(repository.initialize).toHaveBeenCalledWith(expect.objectContaining({
      generationRevision: 2,
      style: 'binance-master',
      styleMode: 'scene',
    }));
  });

  it('serializes only an opaque cover reference after a revision-safe commit', async () => {
    const repository = {
      initialize: vi.fn(),
      markGenerated: vi.fn(async () => record({
        status: 'generated',
        sourceAssetId: 'asset_1',
        sourceMimeType: 'image/jpeg',
      })),
      markFailed: vi.fn(),
      findByArticle: vi.fn(async () => record({
        status: 'generated',
        sourceAssetId: 'asset_1',
        sourceMimeType: 'image/jpeg',
      })),
    };
    await expect(markArticleCoverGenerated({
      repository,
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      generationRevision: 2,
      sourceAssetId: 'asset_1',
      now,
    })).resolves.toMatchObject({
      status: 'generated',
      imageUrl: 'r2://article-assets/asset_1/cover-source.jpg',
    });
    await expect(getArticleCover({
      repository,
      workspaceId: 'workspace_1',
      articleId: 'article_1',
    })).resolves.not.toHaveProperty('sourceAssetId');
  });
});
