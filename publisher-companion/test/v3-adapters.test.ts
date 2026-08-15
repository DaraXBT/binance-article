import { describe, expect, it, mock } from 'bun:test';

import {
  BaoyuBinanceArticleAdapter,
  type BinanceArticleDraft,
  type BinanceArticleSnapshot,
} from '../src/binance-article-adapter';
import {
  BaoyuBinancePostAdapter,
  type BinancePostDraft,
  type BinancePostSnapshot,
} from '../src/binance-post-adapter';
import {
  BaoyuXArticleAdapter,
  XArticleEligibilityError,
  type XArticleDraft,
  type XArticleSnapshot,
} from '../src/x-article-adapter';

const binanceReady: BinancePostSnapshot = {
  url: 'https://www.binance.com/en/square',
  text: 'Reviewed Binance post',
  imageCount: 1,
  mediaSources: ['blob:binance-reviewed'],
  editorVisible: true,
  publishButtonCount: 1,
  publishButtonEnabled: true,
};

const articleReady: XArticleSnapshot = {
  url: 'https://x.com/compose/articles/123',
  title: 'Reviewed X Article',
  body: 'Reviewed body',
  imageCount: 1,
  mediaSources: ['blob:x-reviewed'],
  coverSource: null,
  editorVisible: true,
  publishButtonCount: 1,
  publishButtonEnabled: true,
};

const binanceArticleReady: BinanceArticleSnapshot = {
  url: 'https://www.binance.com/en/square/creator-center/editor',
  title: 'Reviewed Binance Article',
  body: 'Reviewed body',
  imageCount: 0,
  mediaSources: [],
  coverSources: ['blob:reviewed-cover'],
  editorVisible: true,
  publishButtonCount: 1,
  publishButtonEnabled: true,
};

describe('V3 live publisher adapters', () => {
  it('requires an observable reviewed Binance article cover before editor-ready', async () => {
    const draft: BinanceArticleDraft = {
      id: 'binance-article-cover',
      snapshot: mock(async () => ({ ...binanceArticleReady, coverSources: [] })),
      clickPublish: mock(async () => true),
      waitForPublishedUrl: mock(async () => undefined),
      close: mock(async () => undefined),
    };
    const adapter = new BaoyuBinanceArticleAdapter({
      prepare: mock(async () => ({
        draft,
        expectedTitle: binanceArticleReady.title,
        expectedBody: binanceArticleReady.body,
        expectedImageCount: 0,
        expectedCoverCount: 1,
      })),
    });

    await expect(adapter.prepare('/tmp/binance-article.zip')).rejects.toThrow(/cover changed/i);
    expect(draft.clickPublish).not.toHaveBeenCalled();
  });

  it('treats Binance article whitespace edits as a body snapshot change', async () => {
    const snapshots = [binanceArticleReady, { ...binanceArticleReady, body: 'Reviewed  body' }];
    const beforeClick = mock(async () => undefined);
    const draft: BinanceArticleDraft = {
      id: 'binance-article-whitespace',
      snapshot: mock(async () => snapshots.shift()!),
      clickPublish: mock(async () => true),
      waitForPublishedUrl: mock(async () => undefined),
      close: mock(async () => undefined),
    };
    const adapter = new BaoyuBinanceArticleAdapter({
      prepare: mock(async () => ({
        draft,
        expectedTitle: binanceArticleReady.title,
        expectedBody: binanceArticleReady.body,
        expectedImageCount: 0,
        expectedCoverCount: 1,
      })),
    });
    const prepared = await adapter.prepare('/tmp/binance-article.zip');

    await expect(adapter.publish(prepared.draftId, { beforeClick })).rejects.toThrow(/body changed/i);
    expect(beforeClick).not.toHaveBeenCalled();
    expect(draft.clickPublish).not.toHaveBeenCalled();
  });

  it('revalidates a Binance post snapshot and performs one scoped click', async () => {
    const order: string[] = [];
    const draft: BinancePostDraft = {
      id: 'binance-post-1',
      snapshot: mock(async () => { order.push('snapshot'); return binanceReady; }),
      clickPublish: mock(async () => { order.push('click'); return true; }),
      waitForPublishedUrl: mock(async () => 'https://www.binance.com/en/square/post/123'),
      close: mock(async () => { order.push('close'); }),
    };
    const adapter = new BaoyuBinancePostAdapter({
      prepare: mock(async () => ({
        draft, expectedText: binanceReady.text, expectedImageCount: 1,
      })),
    });

    const prepared = await adapter.prepare('/tmp/binance-post.zip');
    const result = await adapter.publish(prepared.draftId, {
      beforeClick: async () => { order.push('begin'); },
    });

    expect(result.publishedUrl).toBe('https://www.binance.com/en/square/post/123');
    expect(order).toEqual(['snapshot', 'snapshot', 'begin', 'click', 'close']);
    expect(draft.clickPublish).toHaveBeenCalledTimes(1);
  });

  it('rejects changed Binance post media before begin', async () => {
    const changed = { ...binanceReady, mediaSources: ['blob:changed'] };
    const snapshots = [binanceReady, changed];
    const beforeClick = mock(async () => undefined);
    const draft: BinancePostDraft = {
      id: 'binance-post-2', snapshot: mock(async () => snapshots.shift()!),
      clickPublish: mock(async () => true), waitForPublishedUrl: mock(async () => undefined),
      close: mock(async () => undefined),
    };
    const adapter = new BaoyuBinancePostAdapter({
      prepare: mock(async () => ({ draft, expectedText: binanceReady.text, expectedImageCount: 1 })),
    });
    const prepared = await adapter.prepare('/tmp/binance-post.zip');

    await expect(adapter.publish(prepared.draftId, { beforeClick })).rejects.toThrow(/images changed/i);
    expect(beforeClick).not.toHaveBeenCalled();
    expect(draft.clickPublish).not.toHaveBeenCalled();
  });

  it('revalidates an X Article snapshot and performs one scoped click', async () => {
    const order: string[] = [];
    const draft: XArticleDraft = {
      id: 'x-article-1',
      snapshot: mock(async () => { order.push('snapshot'); return articleReady; }),
      clickPublish: mock(async () => { order.push('click'); return true; }),
      waitForPublishedUrl: mock(async () => 'https://x.com/i/article/123'),
      close: mock(async () => { order.push('close'); }),
    };
    const adapter = new BaoyuXArticleAdapter({
      prepare: mock(async () => ({
        draft,
        expectedTitle: articleReady.title,
        expectedBody: articleReady.body,
        expectedImageCount: 1,
        expectedCover: false,
      })),
    });

    const prepared = await adapter.prepare('/tmp/x-article.zip');
    const result = await adapter.publish(prepared.draftId, {
      beforeClick: async () => { order.push('begin'); },
    });

    expect(result.publishedUrl).toBe('https://x.com/i/article/123');
    expect(order).toEqual(['snapshot', 'snapshot', 'begin', 'click', 'close']);
    expect(draft.clickPublish).toHaveBeenCalledTimes(1);
  });

  it('treats X Article whitespace edits as a body snapshot change', async () => {
    const snapshots = [articleReady, { ...articleReady, body: 'Reviewed  body' }];
    const beforeClick = mock(async () => undefined);
    const draft: XArticleDraft = {
      id: 'x-article-whitespace',
      snapshot: mock(async () => snapshots.shift()!),
      clickPublish: mock(async () => true),
      waitForPublishedUrl: mock(async () => undefined),
      close: mock(async () => undefined),
    };
    const adapter = new BaoyuXArticleAdapter({
      prepare: mock(async () => ({
        draft,
        expectedTitle: articleReady.title,
        expectedBody: articleReady.body,
        expectedImageCount: 1,
        expectedCover: false,
      })),
    });
    const prepared = await adapter.prepare('/tmp/x-article.zip');

    await expect(adapter.publish(prepared.draftId, { beforeClick })).rejects.toThrow(/body changed/i);
    expect(beforeClick).not.toHaveBeenCalled();
    expect(draft.clickPublish).not.toHaveBeenCalled();
  });

  it('matches the reviewed X Article canonically while pinning the exact browser snapshot', async () => {
    const preparedSnapshot = { ...articleReady, body: 'Reviewed\nbody' };
    const changedSnapshot = { ...articleReady, body: 'Reviewed  body' };
    const snapshots = [preparedSnapshot, changedSnapshot];
    const beforeClick = mock(async () => undefined);
    const draft: XArticleDraft = {
      id: 'x-article-reviewed-whitespace',
      snapshot: mock(async () => snapshots.shift()!),
      clickPublish: mock(async () => true),
      waitForPublishedUrl: mock(async () => undefined),
      close: mock(async () => undefined),
    };
    const adapter = new BaoyuXArticleAdapter({
      prepare: mock(async () => ({
        draft,
        expectedTitle: articleReady.title,
        expectedBody: 'Reviewed body',
        expectedImageCount: 1,
        expectedCover: false,
      })),
    });
    const prepared = await adapter.prepare('/tmp/x-article.zip');

    await expect(adapter.publish(prepared.draftId, { beforeClick })).rejects.toThrow(/body changed/i);
    expect(beforeClick).not.toHaveBeenCalled();
    expect(draft.clickPublish).not.toHaveBeenCalled();
  });

  it.each(['X_LOGIN_REQUIRED', 'X_ARTICLES_UNAVAILABLE'] as const)(
    'preserves the structured %s eligibility abort',
    async (code) => {
      const adapter = new BaoyuXArticleAdapter({
        prepare: mock(async () => { throw new XArticleEligibilityError(code); }),
      });
      await expect(adapter.prepare('/tmp/x-article.zip')).rejects.toMatchObject({ code });
    },
  );
});
