import { describe, expect, it, vi } from 'vitest';

import { createPublisherCommandRepository } from './repository';

function clientReturning(rows: unknown[]) {
  const captured: Array<{ text: string; values: unknown[] }> = [];
  const client = Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ text: strings.join('?'), values });
      return Promise.resolve(rows);
    }),
    { transaction: vi.fn() },
  );
  return { client, captured };
}

function queryReturning(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(async () => rows),
    then: <TResult1 = unknown[], TResult2 = never>(
      onFulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(rows).then(onFulfilled, onRejected),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  return query;
}

function recipeDatabase(genericRows: unknown[], assetRows: unknown[] = []) {
  const genericQuery = queryReturning(genericRows);
  const assetQuery = queryReturning(assetRows);
  const select = vi.fn()
    .mockReturnValueOnce(genericQuery)
    .mockReturnValueOnce(assetQuery);
  return { database: { select } as never, select };
}

describe('publisher command repository', () => {
  it('claims one queued command with a locked skip-locked selection', async () => {
    const { client, captured } = clientReturning([{
      id: 'command_1', draftId: 'draft_1', deviceId: 'device_1', state: 'claimed',
      target: 'x', kind: 'article', revision: 3,
      recipeHash: 'a'.repeat(64), expiresAt: new Date(),
    }]);
    const repository = createPublisherCommandRepository({ $client: client } as never);

    await expect(repository.claimNext({ deviceId: 'device_1', now: new Date() }))
      .resolves.toMatchObject({ id: 'command_1', target: 'x', kind: 'article', state: 'claimed' });
    expect(captured[0]?.text).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(captured[0]?.text).toMatch(/WITH expired_commands AS/);
    expect(captured[0]?.text).toMatch(/UPDATE "PublishApproval"/);
    expect(captured[0]?.text).not.toMatch(/'publishing'/);
    expect(captured[0]?.text).toMatch(/UPDATE "PublisherCommand"/);
    expect(captured[0]?.text).toMatch(/command\."target", command\."kind", command\."state"/);
    expect(captured[0]?.text).not.toContain('device_1');
    expect(captured[0]?.values).toContain('device_1');
  });

  it('updates command and publication draft state in one compare-and-swap statement', async () => {
    const { client, captured } = clientReturning([{ id: 'command_1' }]);
    const repository = createPublisherCommandRepository({ $client: client } as never);

    await expect(repository.compareAndSwap({
      commandId: 'command_1', deviceId: 'device_1', revision: 3,
      from: 'publishing', to: 'succeeded', now: new Date(),
      publishedUrl: 'https://www.binance.com/en/square/post/123',
    })).resolves.toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.text).toMatch(/WITH updated_command AS/);
    expect(captured[0]?.text).toMatch(/UPDATE "PublisherCommand"/);
    expect(captured[0]?.text).toMatch(/UPDATE "BinancePublicationDraft"/);
  });

  it('loads status by exact assigned device without recipe or credential data', async () => {
    const { client, captured } = clientReturning([{
      id: 'command_1', draftId: 'draft_1', deviceId: 'device_1', state: 'approved',
      target: 'x', kind: 'article', revision: 3,
      recipeHash: 'a'.repeat(64), expiresAt: new Date(),
    }]);
    const repository = createPublisherCommandRepository({ $client: client } as never);
    await expect(repository.loadStatus({ deviceId: 'device_1', commandId: 'command_1' }))
      .resolves.toMatchObject({ target: 'x', kind: 'article' });
    expect(captured[0].text).toMatch(/"deviceId" = \?/);
    expect(captured[0].text).toMatch(/"target", "kind", "state"/);
    expect(captured[0].text).not.toMatch(/markdown|r2Key|tokenHash|failureReason/i);
  });

  it('reconstructs a V3 text-only post from the persisted draft kind', async () => {
    const expiresAt = new Date('2026-08-16T00:15:00.000Z');
    const { database, select } = recipeDatabase([{
      command: {
        id: 'command_post', deviceId: 'device_1', state: 'claimed', revision: 3,
        recipeHash: 'a'.repeat(64), target: 'binance-square', kind: 'post',
      },
      draft: {
        id: 'draft_post', articleId: 'article_1', revision: 3, expiresAt,
        target: 'binance-square', kind: 'post', version: 3,
        payload: { text: 'Text only', orderedAssetIds: [] }, workspaceId: 'workspace_1',
      },
    }]);
    const repository = createPublisherCommandRepository(database);

    await expect(repository.loadRecipe({ deviceId: 'device_1', commandId: 'command_post' }))
      .resolves.toEqual({
        command: {
          id: 'command_post', deviceId: 'device_1', state: 'claimed', revision: 3,
          recipeHash: 'a'.repeat(64), target: 'binance-square', kind: 'post',
        },
        recipe: {
          version: 3, target: 'binance-square', kind: 'post', draftId: 'draft_post',
          articleId: 'article_1', revision: 3, expiresAt: expiresAt.toISOString(),
          text: 'Text only', orderedAssetIds: [], assets: [],
        },
      });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('omits an unselected cover when reconstructing a V3 X article', async () => {
    const expiresAt = new Date('2026-08-16T00:15:00.000Z');
    const { database, select } = recipeDatabase([{
      command: {
        id: 'command_article', deviceId: 'device_1', state: 'claimed', revision: 4,
        recipeHash: 'b'.repeat(64), target: 'x', kind: 'article',
      },
      draft: {
        id: 'draft_article', articleId: 'article_1', revision: 4, expiresAt,
        target: 'x', kind: 'article', version: 3,
        payload: { title: 'Title', markdown: 'Body', orderedAssetIds: [] },
        workspaceId: 'workspace_1',
      },
    }]);
    const repository = createPublisherCommandRepository(database);

    const loaded = await repository.loadRecipe({
      deviceId: 'device_1', commandId: 'command_article',
    });
    expect(loaded?.recipe).toEqual({
      version: 3, target: 'x', kind: 'article', draftId: 'draft_article',
      articleId: 'article_1', revision: 4, expiresAt: expiresAt.toISOString(),
      title: 'Title', markdown: 'Body', orderedAssetIds: [], assets: [],
    });
    expect(loaded?.recipe).not.toHaveProperty('cover');
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('retrieves an optional X article cover during V3 reconstruction', async () => {
    const expiresAt = new Date('2026-08-16T00:15:00.000Z');
    const cover = {
      assetId: 'cover_1', focalX: 0.5, focalY: 0.5,
      targetWidth: 1000, targetHeight: 400,
    };
    const coverAsset = {
      id: 'cover_1', mimeType: 'image/webp', sizeBytes: 1_024, sha256: 'c'.repeat(64),
    };
    const { database, select } = recipeDatabase([{
      command: {
        id: 'command_article', deviceId: 'device_1', state: 'claimed', revision: 4,
        recipeHash: 'b'.repeat(64), target: 'x', kind: 'article',
      },
      draft: {
        id: 'draft_article', articleId: 'article_1', revision: 4, expiresAt,
        target: 'x', kind: 'article', version: 3,
        payload: { title: 'Title', markdown: 'Body', cover, orderedAssetIds: [] },
        workspaceId: 'workspace_1',
      },
    }], [coverAsset]);
    const repository = createPublisherCommandRepository(database);

    const loaded = await repository.loadRecipe({
      deviceId: 'device_1', commandId: 'command_article',
    });
    expect(loaded?.recipe).toMatchObject({
      version: 3, target: 'x', kind: 'article', cover, assets: [coverAsset],
    });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('persists expiry across command, draft, and open approval without touching publishing', async () => {
    const { client, captured } = clientReturning([{ id: 'command_1' }]);
    const repository = createPublisherCommandRepository({ $client: client } as never);
    await expect(repository.compareAndSwap({
      commandId: 'command_1', deviceId: 'device_1', revision: 3,
      from: 'awaiting_review', to: 'expired', now: new Date(),
    })).resolves.toBe(true);
    expect(captured[0].text).toMatch(/"state" = \?::"PublisherCommandState"/);
    expect(captured[0].values).toContain('expired');
    expect(captured[0].text).toMatch(/'expired'::"PublicationDraftStatus"/);
    expect(captured[0].text).toMatch(/'expired'::"PublishApprovalState"/);
    expect(captured[0].text).toMatch(/UPDATE "PublishApproval"/);
  });

  it('atomically aborts command, draft, and any open approval before publishing', async () => {
    const { client, captured } = clientReturning([{ id: 'command_1' }]);
    const repository = createPublisherCommandRepository({ $client: client } as never);
    await expect(repository.abort({
      deviceId: 'device_1', commandId: 'command_1', revision: 3,
      reasonCode: 'EDITOR_COMPOSITION_FAILED', now: new Date(),
    })).resolves.toBe(true);
    expect(captured[0].text).toMatch(/UPDATE "PublisherCommand"/);
    expect(captured[0].text).toMatch(/UPDATE "BinancePublicationDraft"/);
    expect(captured[0].text).toMatch(/UPDATE "PublishApproval"/);
    expect(captured[0].text).toMatch(/'publishing'/);
  });
});
