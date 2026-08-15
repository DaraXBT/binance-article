import { describe, expect, it } from 'bun:test';

import type { XArticleCompositionContext } from '../../.agents/skills/baoyu-post-to-x/scripts/x-article';
import type { XArticlePublishGuard } from '../src/x-article-adapter';
import { createManagedXArticleDraft } from '../src/x-article-live-composer';

type CdpHandler = (
  params: unknown,
  metadata: { sessionId?: string },
) => void;

describe('managed X Article publication evidence', () => {
  it('attributes only a new strict canonical main-frame URL from its own session', async () => {
    const order: string[] = [];
    const handlers = new Map<string, Set<CdpHandler>>();
    const staleUrl = 'https://x.com/i/article/111';
    const publishedUrl = 'https://x.com/i/article/222';
    const cdp = {
      on(method: string, handler: CdpHandler) {
        order.push(`subscribe:${method}`);
        if (!handlers.has(method)) handlers.set(method, new Set());
        handlers.get(method)!.add(handler);
        return () => handlers.get(method)?.delete(handler);
      },
      async send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame' } } } as T;
        }
        if (method === 'Runtime.evaluate') {
          const expression = String(params?.expression ?? '');
          if (expression.includes('button.click()')) {
            order.push('baseline-and-guarded-click');
            return {
              result: {
                value: {
                  clicked: true,
                  guardMatched: true,
                  baselineCandidates: [staleUrl],
                },
              },
            } as T;
          }
          order.push('fallback-poll');
          return { result: { value: [staleUrl] } } as T;
        }
        throw new Error(`Unexpected CDP method: ${method}`);
      },
      close() {},
    };
    const context = {
      cdp,
      sessionId: 'managed-session',
      targetId: 'managed-target',
      ownsBrowser: false,
      ownsTarget: false,
      title: 'Reviewed title',
      body: 'Reviewed body',
      expectedBody: 'Reviewed body',
      imageCount: 0,
      coverPresent: false,
      reviewedBodySequence: [{ kind: 'text', text: 'Reviewed body' }],
      mediaBindings: [],
    } as unknown as XArticleCompositionContext;
    const guard: XArticlePublishGuard = {
      url: 'https://x.com/compose/articles/123',
      editorId: 'editor-a',
      title: 'Reviewed title',
      body: 'Reviewed body',
      bodySequence: [{ kind: 'text', text: 'Reviewed body' }],
      imageCount: 0,
      mediaSources: [],
      bodyMediaDomSources: [],
      coverSource: null,
      coverSources: [],
      coverDomSources: [],
      editorVisible: true,
      publishButtonCount: 1,
      publishButtonEnabled: true,
    };
    const draft = createManagedXArticleDraft('managed-draft', context);

    await expect(draft.clickPublish(guard)).resolves.toBe(true);
    const subscribeIndexes = order
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.startsWith('subscribe:'))
      .map(({ index }) => index);
    expect(subscribeIndexes).toHaveLength(2);
    expect(Math.max(...subscribeIndexes)).toBeLessThan(order.indexOf('baseline-and-guarded-click'));

    let settled = false;
    const publication = draft.waitForPublishedUrl().then((value) => {
      settled = true;
      return value;
    });
    const emit = (method: string, params: unknown, sessionId: string) => {
      for (const handler of handlers.get(method) ?? []) handler(params, { sessionId });
    };
    const flush = async () => {
      await Promise.resolve();
      await Promise.resolve();
    };

    emit('Page.navigatedWithinDocument', { frameId: 'main-frame', url: staleUrl }, 'managed-session');
    await flush();
    expect(settled).toBe(false);

    emit('Page.navigatedWithinDocument', {
      frameId: 'main-frame', url: publishedUrl,
    }, 'other-session');
    emit('Page.navigatedWithinDocument', {
      frameId: 'main-frame', url: 'https://X.com/i/article/222',
    }, 'managed-session');
    emit('Page.navigatedWithinDocument', {
      frameId: 'child-frame', url: publishedUrl,
    }, 'managed-session');
    await flush();
    expect(settled).toBe(false);

    emit('Page.navigatedWithinDocument', {
      frameId: 'main-frame', url: publishedUrl,
    }, 'managed-session');
    await expect(publication).resolves.toBe(publishedUrl);
  });
});
