import { describe, expect, it, mock } from 'bun:test';

import {
  BaoyuXSkillAdapter,
  type XComposerDraft,
  type XComposerSnapshot,
} from '../src/x-adapter';

const readySnapshot: XComposerSnapshot = {
  url: 'https://x.com/compose/post',
  text: 'Reviewed post',
  imageCount: 2,
  mediaSources: ['blob:reviewed-1', 'blob:reviewed-2'],
  editorVisible: true,
  postButtonCount: 1,
  postButtonEnabled: true,
};

function harness(input: {
  snapshots?: XComposerSnapshot[];
  publishedUrl?: string;
} = {}) {
  const order: string[] = [];
  const snapshots = [...(input.snapshots ?? [readySnapshot, readySnapshot])];
  const draft: XComposerDraft = {
    id: 'x-draft-1',
    snapshot: mock(async () => {
      order.push('snapshot');
      return snapshots.shift() ?? readySnapshot;
    }),
    clickPost: mock(async () => {
      order.push('click');
      return true;
    }),
    waitForPublishedUrl: mock(async () => {
      order.push('wait-for-url');
      return input.publishedUrl;
    }),
    close: mock(async () => { order.push('close'); }),
  };
  const driver = {
    prepare: mock(async () => ({
      draft,
      expectedText: readySnapshot.text,
      expectedImageCount: readySnapshot.imageCount,
    })),
  };
  return { adapter: new BaoyuXSkillAdapter(driver), draft, driver, order };
}

describe('Baoyu X publisher adapter', () => {
  it('fills a ready live composer and begins immediately before exactly one Post click', async () => {
    const h = harness({ publishedUrl: 'https://x.com/example/status/123' });
    const prepared = await h.adapter.prepare('/private/tmp/x-post.zip');
    expect(prepared).toEqual({ draftId: 'x-draft-1' });

    const result = await h.adapter.publish(prepared.draftId, {
      beforeClick: async () => { h.order.push('begin'); },
    });

    expect(result).toEqual({
      verified: true,
      reason: 'canonical X status navigation',
      publishedUrl: 'https://x.com/example/status/123',
    });
    expect(h.order).toEqual([
      'snapshot', 'snapshot', 'begin', 'click', 'wait-for-url', 'close',
    ]);
    expect(h.draft.clickPost).toHaveBeenCalledTimes(1);
  });

  it('returns an ambiguous result without retrying when X exposes no canonical URL', async () => {
    const h = harness({ publishedUrl: 'https://x.com/home' });
    const prepared = await h.adapter.prepare('/private/tmp/x-post.zip');
    const result = await h.adapter.publish(prepared.draftId, {
      beforeClick: async () => { h.order.push('begin'); },
    });

    expect(result).toEqual({
      verified: true,
      reason: 'X did not expose a canonical status URL.',
    });
    expect(h.draft.clickPost).toHaveBeenCalledTimes(1);
    await expect(h.adapter.publish(prepared.draftId, {
      beforeClick: async () => undefined,
    })).rejects.toThrow(/not found/i);
    expect(h.draft.clickPost).toHaveBeenCalledTimes(1);
  });

  it('never clicks if begin fails and does not permit a second attempt', async () => {
    const h = harness();
    const prepared = await h.adapter.prepare('/private/tmp/x-post.zip');
    await expect(h.adapter.publish(prepared.draftId, {
      beforeClick: async () => {
        h.order.push('begin');
        throw new Error('begin response lost');
      },
    })).rejects.toThrow(/begin response lost/i);

    expect(h.draft.clickPost).not.toHaveBeenCalled();
    await expect(h.adapter.publish(prepared.draftId, {
      beforeClick: async () => undefined,
    })).rejects.toThrow(/not found/i);
    expect(h.draft.clickPost).not.toHaveBeenCalled();
  });

  it('rejects a changed or non-ready composer before begin', async () => {
    const changed = { ...readySnapshot, text: 'Edited after review' };
    const h = harness({ snapshots: [readySnapshot, changed] });
    const prepared = await h.adapter.prepare('/private/tmp/x-post.zip');
    const beforeClick = mock(async () => undefined);

    await expect(h.adapter.publish(prepared.draftId, { beforeClick }))
      .rejects.toThrow(/text changed/i);
    expect(beforeClick).not.toHaveBeenCalled();
    expect(h.draft.clickPost).not.toHaveBeenCalled();
  });
});
