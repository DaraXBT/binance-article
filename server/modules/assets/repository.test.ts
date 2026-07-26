import { describe, expect, it, vi } from 'vitest';

import { createArticleAssetRepository } from './repository';

describe('article asset repository', () => {
  it('atomically retires prior slide versions and inserts metadata for an owned article', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const transaction = vi.fn(async (
      build: (query: (strings: TemplateStringsArray, ...values: unknown[]) => unknown) => unknown[],
      options: unknown,
    ) => {
      const queries = build((strings, ...values) => {
        captured.push({ text: strings.join('?'), values });
        return { text: strings.join('?'), values };
      });
      expect(queries).toHaveLength(2);
      expect(options).toEqual({ isolationLevel: 'ReadCommitted' });
      return [[], [{ assetId: 'asset_2', retiredR2Keys: ['old/key.png'] }]];
    });
    const repository = createArticleAssetRepository({ $client: { transaction } } as never);
    const now = new Date('2026-07-19T12:00:00.000Z');

    await expect(repository.replaceAsset({
      assetId: 'asset_2', workspaceId: 'workspace_1', articleId: 'article_1',
      r2Key: 'workspaces/workspace_1/articles/article_1/slides/slide_1/asset_2.png',
      assetKeyPrefix: 'workspaces/workspace_1/articles/article_1/slides/slide_1/',
      purpose: 'slide_image',
      mimeType: 'image/png', sizeBytes: 3, sha256: 'a'.repeat(64), now,
    })).resolves.toEqual({ assetId: 'asset_2', retiredR2Keys: ['old/key.png'] });

    expect(captured[0]?.text).toMatch(/pg_advisory_xact_lock[\s\S]*hashtextextended/);
    expect(captured[0]?.values).toContain(
      'workspaces/workspace_1/articles/article_1/slides/slide_1/',
    );
    expect(captured[1]?.text).toMatch(/UPDATE "StorageObject"[\s\S]*"deletedAt"/);
    expect(captured[1]?.text).toMatch(/INSERT INTO "StorageObject"/);
    expect(captured[1]?.text).toMatch(/FROM "DeckProject"/);
    expect(captured[1]?.text).toMatch(/article\."workspaceId" =/);
    expect(captured[1]?.text).toContain('?::"StorageObjectPurpose"');
    expect(captured[1]?.values).toEqual(expect.arrayContaining([
      'asset_2', 'workspace_1', 'article_1', 'slide_image', 'a'.repeat(64), now,
    ]));
  });

  it('retires stale covers only while the article is still at the expected revision', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const client = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ text: strings.join('?'), values });
      return [{ retiredR2Keys: ['covers/rev-1/old.png'] }];
    });
    const repository = createArticleAssetRepository({ $client: client } as never);
    const now = new Date('2026-07-26T12:00:00.000Z');

    await expect(repository.retireCoverAssetsOutsidePrefix({
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      keepPrefix: 'workspaces/workspace_1/articles/article_1/covers/rev-2/',
      expectedGenerationRevision: 2,
      now,
    })).resolves.toEqual(['covers/rev-1/old.png']);

    // The article gate re-checks the generation revision so a stale job can
    // never retire a newer cover, and only rows outside the kept prefix are
    // touched.
    expect(captured[0]?.text).toMatch(/"generationRevision" =/);
    expect(captured[0]?.text).toMatch(/'cover_image'::"StorageObjectPurpose"/);
    expect(captured[0]?.text).toMatch(/NOT LIKE \? \|\| '%'/);
    expect(captured[0]?.text).toMatch(/"deletedAt" IS NULL/);
    expect(captured[0]?.values).toEqual(expect.arrayContaining([
      'workspace_1', 'article_1', 2,
      'workspaces/workspace_1/articles/article_1/covers/rev-2/', now,
    ]));
  });

  it('authorizes reads by active metadata, workspace, and article', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const client = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ text: strings.join('?'), values });
      return [{ r2Key: 'private/key.png', mimeType: 'image/png', sizeBytes: 3, sha256: 'b'.repeat(64) }];
    });
    const repository = createArticleAssetRepository({ $client: client } as never);

    await repository.authorizeAsset({
      assetId: 'asset_1', workspaceId: 'workspace_1', articleId: 'article_1',
    });

    expect(captured[0]?.text).toMatch(/FROM "StorageObject" AS asset/);
    expect(captured[0]?.text).toMatch(/asset\."deletedAt" IS NULL/);
    expect(captured[0]?.text).toContain("'slide_image'::\"StorageObjectPurpose\"");
    expect(captured[0]?.text).toContain("'cover_image'::\"StorageObjectPurpose\"");
    expect(captured[0]?.text).toMatch(/asset\."workspaceId" =/);
    expect(captured[0]?.text).toMatch(/asset\."articleId" =/);
  });
});
