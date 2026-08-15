import { describe, expect, it, mock } from 'bun:test';

import { hashPublicationRecipe } from '../../server/domain/publication-recipe';
import { runPublisherOnce } from '../src/runner';

function articleRecipe() {
  return {
    version: 3 as const,
    target: 'x' as const,
    kind: 'article' as const,
    draftId: 'draft_article',
    articleId: 'article_1',
    revision: 3,
    expiresAt: '2026-07-19T00:15:00.000Z',
    title: 'Reviewed X article',
    markdown: '## Body\n\nMedia is optional.',
    orderedAssetIds: [],
    assets: [],
  };
}

async function harness() {
  const order: string[] = [];
  const recipe = articleRecipe();
  const recipeHash = await hashPublicationRecipe(recipe);
  const statuses = ['awaiting_review', 'awaiting_approval', 'approved'] as const;
  let statusIndex = 0;
  const metadata = (state: 'claimed' | 'awaiting_review' | 'awaiting_approval' | 'approved') => ({
    id: 'command_1',
    draftId: recipe.draftId,
    deviceId: 'device_1',
    state,
    revision: recipe.revision,
    recipeHash,
    expiresAt: recipe.expiresAt,
    target: recipe.target,
    kind: recipe.kind,
  });
  const api = {
    claimCommand: mock(async () => metadata('claimed')),
    getRecipe: mock(async () => recipe),
    downloadAsset: mock(async () => new Response()),
    reportEditorReady: mock(async () => { order.push('editor-ready'); }),
    getCommandStatus: mock(async () => metadata(statuses[statusIndex++] ?? 'approved')),
    beginPublish: mock(async () => { order.push('begin'); }),
    reportResult: mock(async (_id: string, _revision: number, result: { outcome: string }) => {
      order.push(`result:${result.outcome}`);
    }),
    abortCommand: mock(async (_id: string, _revision: number, reason: string) => {
      order.push(`abort:${reason}`);
    }),
  };
  const articleAdapter = {
    prepare: mock(async () => { order.push('article:prepare'); return { draftId: 'local_article' }; }),
    publish: mock(async (_draftId: string, options: { beforeClick: () => Promise<void> }) => {
      order.push('article:revalidate');
      await options.beforeClick();
      order.push('article:click');
      return {
        verified: true as const,
        publishedUrl: 'https://x.com/i/article/123456',
      };
    }),
  };
  const postAdapter = {
    prepare: mock(async () => { order.push('post:prepare'); return { draftId: 'local_post' }; }),
    publish: mock(async () => ({ verified: true as const })),
  };
  const articleMaterializer = mock(async () => {
    order.push('article:materialize');
    return { bundleBytes: new Uint8Array([1]), manifest: {} };
  });
  const postMaterializer = mock(async () => {
    order.push('post:materialize');
    return { bundleBytes: new Uint8Array([2]), manifest: {} };
  });
  const workspace = {
    writeBundle: mock(async () => { order.push('bundle'); return '/private/tmp/article.zip'; }),
    removeBundle: mock(async () => { order.push('cleanup'); }),
  };
  return {
    order, recipe, api, articleAdapter, postAdapter,
    articleMaterializer, postMaterializer, workspace,
  };
}

function runnerInput(h: Awaited<ReturnType<typeof harness>>) {
  return {
    api: h.api,
    adapters: {
      'x:article': h.articleAdapter,
      'x:post': h.postAdapter,
    },
    materializers: {
      'x:article': h.articleMaterializer,
      'x:post': h.postMaterializer,
    },
    workspace: h.workspace,
    now: () => new Date('2026-07-19T00:00:00.000Z'),
    sleep: async () => undefined,
  };
}

describe('target-and-kind publisher routing', () => {
  it('keeps a kind-backfilled V2 Binance command on the target-only compatibility route', async () => {
    const recipe = {
      version: 2 as const,
      target: 'binance-square' as const,
      draftId: 'draft_legacy_binance',
      articleId: 'article_1',
      revision: 3,
      expiresAt: '2026-07-19T00:15:00.000Z',
      title: 'Legacy reviewed article',
      markdown: 'Legacy body',
      cover: {
        assetId: 'asset_cover',
        focalX: 0.5,
        focalY: 0.5,
        targetWidth: 1000 as const,
        targetHeight: 400 as const,
      },
      orderedAssetIds: [],
      assets: [{
        id: 'asset_cover',
        mimeType: 'image/png' as const,
        sizeBytes: 8,
        sha256: 'a'.repeat(64),
      }],
    };
    const recipeHash = await hashPublicationRecipe(recipe);
    const metadata = (state: 'claimed' | 'awaiting_review' | 'awaiting_approval' | 'approved') => ({
      id: 'command_legacy_binance',
      draftId: recipe.draftId,
      deviceId: 'device_1',
      state,
      revision: recipe.revision,
      recipeHash,
      expiresAt: recipe.expiresAt,
      target: recipe.target,
      // Migration 0017 backfills this even though the recipe remains V2.
      kind: 'article' as const,
    });
    const statuses = ['awaiting_review', 'awaiting_approval', 'approved'] as const;
    let statusIndex = 0;
    const api = {
      claimCommand: mock(async () => metadata('claimed')),
      getRecipe: mock(async () => recipe),
      downloadAsset: mock(async () => new Response()),
      reportEditorReady: mock(async () => undefined),
      getCommandStatus: mock(async () => metadata(statuses[statusIndex++] ?? 'approved')),
      beginPublish: mock(async () => undefined),
      reportResult: mock(async () => undefined),
      abortCommand: mock(async () => undefined),
    };
    const compatibilityAdapter = {
      prepare: mock(async () => ({ draftId: 'legacy_browser_draft' })),
      publish: mock(async (_draftId: string, options: { beforeClick: () => Promise<void> }) => {
        await options.beforeClick();
        return {
          verified: true as const,
          publishedUrl: 'https://www.binance.com/en/square/article/123456',
        };
      }),
    };
    const v3ArticleAdapter = {
      prepare: mock(async () => ({ draftId: 'wrong_v3_draft' })),
      publish: mock(async () => ({ verified: true as const })),
    };
    const compatibilityMaterializer = mock(async () => ({
      bundleBytes: new Uint8Array([1]), manifest: { schemaVersion: 1 },
    }));
    const v3ArticleMaterializer = mock(async () => ({
      bundleBytes: new Uint8Array([2]), manifest: { schemaVersion: 2 },
    }));

    await expect(runPublisherOnce({
      api,
      adapters: {
        'binance-square': compatibilityAdapter,
        'binance-square:article': v3ArticleAdapter,
      },
      materializers: {
        'binance-square': compatibilityMaterializer,
        'binance-square:article': v3ArticleMaterializer,
      },
      workspace: {
        writeBundle: mock(async () => '/private/tmp/legacy-binance.zip'),
        removeBundle: mock(async () => undefined),
      },
      now: () => new Date('2026-07-19T00:00:00.000Z'),
      sleep: async () => undefined,
    })).resolves.toEqual({
      outcome: 'succeeded', commandId: 'command_legacy_binance',
    });

    expect(compatibilityMaterializer).toHaveBeenCalledTimes(1);
    expect(compatibilityAdapter.prepare).toHaveBeenCalledTimes(1);
    expect(v3ArticleMaterializer).not.toHaveBeenCalled();
    expect(v3ArticleAdapter.prepare).not.toHaveBeenCalled();
  });

  it('routes an X article through only the X article materializer and adapter', async () => {
    const h = await harness();
    await expect(runPublisherOnce(runnerInput(h))).resolves.toEqual({
      outcome: 'succeeded', commandId: 'command_1',
    });

    expect(h.articleMaterializer).toHaveBeenCalledTimes(1);
    expect(h.articleAdapter.prepare).toHaveBeenCalledTimes(1);
    expect(h.postMaterializer).not.toHaveBeenCalled();
    expect(h.postAdapter.prepare).not.toHaveBeenCalled();
    expect(h.order).toEqual([
      'article:materialize', 'bundle', 'article:prepare', 'editor-ready',
      'article:revalidate', 'begin', 'article:click', 'result:succeeded', 'cleanup',
    ]);
    expect(h.order.filter((entry) => entry === 'article:click')).toHaveLength(1);
  });

  it.each(['X_ARTICLES_UNAVAILABLE', 'X_LOGIN_REQUIRED'] as const)(
    'reports the stable %s eligibility abort without clicking',
    async (code) => {
      const h = await harness();
      h.articleAdapter.prepare.mockImplementationOnce(async () => {
        throw Object.assign(new Error('local browser detail'), { code });
      });

      await expect(runPublisherOnce(runnerInput(h))).resolves.toEqual({
        outcome: 'cancelled', commandId: 'command_1',
      });
      expect(h.api.abortCommand).toHaveBeenCalledWith('command_1', 3, code);
      expect(h.articleAdapter.publish).not.toHaveBeenCalled();
      expect(h.api.beginPublish).not.toHaveBeenCalled();
    },
  );

  it('treats an error after the sole article click as outcome_unknown and never retries', async () => {
    const h = await harness();
    h.articleAdapter.publish.mockImplementationOnce(async (_draftId, options) => {
      await options.beforeClick();
      h.order.push('article:click');
      throw new Error('navigation response lost');
    });

    await expect(runPublisherOnce(runnerInput(h))).resolves.toEqual({
      outcome: 'outcome_unknown', commandId: 'command_1',
    });
    expect(h.articleAdapter.publish).toHaveBeenCalledTimes(1);
    expect(h.order.filter((entry) => entry === 'article:click')).toHaveLength(1);
    expect(h.api.reportResult).toHaveBeenCalledWith('command_1', 3, {
      outcome: 'outcome_unknown', failureReason: 'OUTCOME_UNVERIFIED',
    });
  });

  it('rejects kind metadata changes while awaiting approval before begin or click', async () => {
    const h = await harness();
    h.api.getCommandStatus.mockResolvedValueOnce({
      id: 'command_1', state: 'awaiting_review', revision: 3,
      recipeHash: await hashPublicationRecipe(h.recipe), expiresAt: h.recipe.expiresAt,
      target: 'x', kind: 'post',
    } as never);

    await expect(runPublisherOnce(runnerInput(h))).resolves.toEqual({
      outcome: 'cancelled', commandId: 'command_1',
    });
    expect(h.api.beginPublish).not.toHaveBeenCalled();
    expect(h.articleAdapter.publish).not.toHaveBeenCalled();
    expect(h.api.abortCommand).toHaveBeenCalledWith('command_1', 3, 'EDITOR_COMPOSITION_FAILED');
  });

  it('fails closed when a V3 command omits kind metadata', async () => {
    const h = await harness();
    h.api.claimCommand.mockResolvedValueOnce({
      id: 'command_1', draftId: h.recipe.draftId, deviceId: 'device_1', state: 'claimed',
      revision: h.recipe.revision, recipeHash: await hashPublicationRecipe(h.recipe),
      expiresAt: h.recipe.expiresAt, target: 'x',
    } as never);

    await expect(runPublisherOnce(runnerInput(h))).resolves.toEqual({
      outcome: 'cancelled', commandId: 'command_1',
    });
    expect(h.articleMaterializer).not.toHaveBeenCalled();
    expect(h.articleAdapter.prepare).not.toHaveBeenCalled();
    expect(h.api.abortCommand).toHaveBeenCalledWith('command_1', 3, 'ASSET_INTEGRITY_FAILED');
  });

  it('does not route V3 through a target-only compatibility adapter', async () => {
    const h = await harness();
    const targetOnlyAdapter = {
      prepare: mock(async () => ({ draftId: 'wrong' })),
      publish: mock(async () => ({ verified: true as const })),
    };
    const input = runnerInput(h);

    await expect(runPublisherOnce({
      ...input,
      adapters: { x: targetOnlyAdapter },
    })).resolves.toEqual({ outcome: 'cancelled', commandId: 'command_1' });
    expect(targetOnlyAdapter.prepare).not.toHaveBeenCalled();
    expect(h.api.abortCommand).toHaveBeenCalledWith('command_1', 3, 'EDITOR_COMPOSITION_FAILED');
  });
});
