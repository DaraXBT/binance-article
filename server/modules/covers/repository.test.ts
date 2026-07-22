import { describe, expect, it, vi } from 'vitest';

import { createArticleCoverRepository } from './repository';

describe('article cover repository', () => {
  it('initializes pending state only against the current owned generation revision', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const client = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ text: strings.join('?'), values });
      return [{
        id: 'cover_1', workspaceId: 'workspace_1', articleId: 'article_1',
        generationRevision: 2, style: 'binance-master', styleMode: 'scene',
        prompt: 'prompt', status: 'pending', sourceAssetId: null, sourceMimeType: null,
        error: null, createdAt: new Date(), updatedAt: new Date(),
      }];
    });
    const repository = createArticleCoverRepository({ $client: client } as never);
    await repository.initialize({
      id: 'cover_1', workspaceId: 'workspace_1', articleId: 'article_1',
      generationRevision: 2, style: 'binance-master', styleMode: 'scene',
      prompt: 'prompt', now: new Date('2026-07-22T00:00:00.000Z'),
    });
    expect(captured[0]?.text).toMatch(/INSERT INTO "ArticleCover"/);
    expect(captured[0]?.text).toMatch(/deck\."generationRevision" =/);
    expect(captured[0]?.text).toMatch(/ON CONFLICT \("articleId"\) DO UPDATE/);
    expect(captured[0]?.text).toMatch(/current_deck\."generationRevision" = EXCLUDED\."generationRevision"/);
  });

  it('links only an active cover_image asset while the revision remains current', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const client = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ text: strings.join('?'), values });
      return [];
    });
    const repository = createArticleCoverRepository({ $client: client } as never);
    await repository.markGenerated({
      workspaceId: 'workspace_1', articleId: 'article_1', generationRevision: 2,
      sourceAssetId: 'asset_1', now: new Date('2026-07-22T00:00:00.000Z'),
    });
    expect(captured[0]?.text).toMatch(/asset\."purpose" = 'cover_image'/);
    expect(captured[0]?.text).toMatch(/asset\."deletedAt" IS NULL/);
    expect(captured[0]?.text).toMatch(/deck\."generationRevision" = cover\."generationRevision"/);
  });
});
