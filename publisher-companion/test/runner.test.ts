import { describe, expect, it, mock } from 'bun:test';

import { hashPublicationRecipe } from '../../server/domain/publication-recipe';
import { runPublisherOnce } from '../src/runner';

const recipe = {
  version: 1 as const,
  draftId: 'draft_1', articleId: 'article_1', revision: 3,
  expiresAt: '2026-07-19T00:15:00.000Z', title: 'Safe article',
  markdown: '## Body\n\n![Chart](asset:asset_1)',
  cover: { assetId: 'asset_1', focalX: 0.5, focalY: 0.5, targetWidth: 1000 as const, targetHeight: 400 as const },
  orderedAssetIds: ['asset_1'],
  assets: [{ id: 'asset_1', mimeType: 'image/png' as const, sizeBytes: 8, sha256: 'a'.repeat(64) }],
};

async function harness() {
  const order: string[] = [];
  const recipeHash = await hashPublicationRecipe(recipe);
  const statuses = ['awaiting_review', 'awaiting_approval', 'approved'];
  const api = {
    claimCommand: mock(async () => ({
      id: 'command_1', draftId: 'draft_1', deviceId: 'device_1', state: 'claimed',
      revision: 3, recipeHash, expiresAt: recipe.expiresAt,
    })),
    getRecipe: mock(async () => recipe),
    downloadAsset: mock(async () => new Response()),
    reportEditorReady: mock(async () => { order.push('editor-ready'); }),
    getCommandStatus: mock(async () => ({
      id: 'command_1', state: statuses.shift() ?? 'approved', revision: 3,
      recipeHash, expiresAt: recipe.expiresAt,
    })),
    beginPublish: mock(async () => { order.push('begin'); }),
    reportResult: mock(async (_id: string, _revision: number, result: unknown) => {
      order.push(`result:${(result as { outcome: string }).outcome}`);
    }),
    abortCommand: mock(async () => { order.push('abort'); }),
  };
  const adapter = {
    prepare: mock(async () => { order.push('prepare'); return { draftId: 'local_draft_1' }; }),
    publish: mock(async (_draftId: string, options: { beforeClick: () => Promise<void> }) => {
      order.push('revalidate');
      await options.beforeClick();
      order.push('click');
      return { verified: true as const, publishedUrl: 'https://www.binance.com/en/square/post/123' };
    }),
  };
  const workspace = {
    writeBundle: mock(async () => { order.push('bundle'); return '/private/tmp/command_1.zip'; }),
    removeBundle: mock(async () => { order.push('cleanup'); }),
  };
  const materialize = mock(async (input: { downloadAsset: (asset: typeof recipe.assets[number]) => Promise<Uint8Array> }) => {
    order.push('materialize');
    await input.downloadAsset(recipe.assets[0]);
    return { bundleBytes: new Uint8Array([1, 2, 3]), manifest: {} };
  });
  const downloadAsset = mock(async () => { order.push('download'); return new Uint8Array(8); });
  return { order, api, adapter, workspace, materialize, downloadAsset };
}

describe('publisher companion runner', () => {
  it('runs claim → verify/assets → prepare → review → approval → begin → click → result', async () => {
    const h = await harness();
    await expect(runPublisherOnce({
      ...h,
      now: () => new Date('2026-07-19T00:00:00.000Z'),
      sleep: async () => undefined,
    })).resolves.toEqual({ outcome: 'succeeded', commandId: 'command_1' });

    expect(h.order).toEqual([
      'materialize', 'download', 'bundle', 'prepare', 'editor-ready',
      'revalidate', 'begin', 'click', 'result:succeeded', 'cleanup',
    ]);
  });

  it('reports outcome_unknown when Binance success lacks a canonical URL', async () => {
    const h = await harness();
    h.adapter.publish.mockImplementationOnce(async (_id, options) => {
      await options.beforeClick();
      return { verified: true as const };
    });
    await expect(runPublisherOnce({
      ...h, now: () => new Date('2026-07-19T00:00:00.000Z'), sleep: async () => undefined,
    })).resolves.toEqual({ outcome: 'outcome_unknown', commandId: 'command_1' });
    expect(h.api.reportResult).toHaveBeenCalledWith('command_1', 3, {
      outcome: 'outcome_unknown', failureReason: 'OUTCOME_UNVERIFIED',
    });
  });

  it('aborts with a fixed code when local composition fails before begin', async () => {
    const h = await harness();
    h.adapter.prepare.mockRejectedValueOnce(new Error('/private/chrome/profile leaked detail'));
    await expect(runPublisherOnce({
      ...h, now: () => new Date('2026-07-19T00:00:00.000Z'), sleep: async () => undefined,
    })).resolves.toEqual({ outcome: 'cancelled', commandId: 'command_1' });
    expect(h.api.abortCommand).toHaveBeenCalledWith('command_1', 3, 'EDITOR_COMPOSITION_FAILED');
    expect(JSON.stringify(h.api.abortCommand.mock.calls)).not.toContain('/private/chrome');
  });
});
