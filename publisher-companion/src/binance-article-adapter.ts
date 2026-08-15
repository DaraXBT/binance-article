import { rm } from 'node:fs/promises';

import {
  publishArticle,
  releaseBinanceArticleBrowserResource,
  type ArticleCompositionContext,
} from '../../.agents/skills/baoyu-post-to-binance-square/scripts/binance-article';
import {
  BS_SELECTORS,
  sleep,
} from '../../.agents/skills/baoyu-post-to-binance-square/scripts/binance-utils';

import type { PublisherAdapter } from './skill-adapter';
import { canonicalBinancePublicationUrl } from './skill-adapter';
import { extractV3PublicationBundle } from './v3-bundle';

export type BinanceArticleSnapshot = {
  url: string;
  title: string;
  body: string;
  imageCount: number;
  mediaSources: string[];
  coverSources: string[];
  editorVisible: boolean;
  publishButtonCount: number;
  publishButtonEnabled: boolean;
};

export type BinanceArticleDraft = {
  id: string;
  snapshot(): Promise<BinanceArticleSnapshot>;
  clickPublish(): Promise<boolean>;
  waitForPublishedUrl(): Promise<string | undefined>;
  close(): Promise<void>;
};

export type PreparedBinanceArticle = {
  draft: BinanceArticleDraft;
  expectedTitle: string;
  expectedBody: string;
  expectedImageCount: number;
  expectedCoverCount: number;
};

export type BinanceArticleDriver = {
  prepare(bundlePath: string): Promise<PreparedBinanceArticle>;
};

type LiveSession = Pick<
  ArticleCompositionContext,
  'cdp' | 'sessionId' | 'targetId' | 'ownsBrowser' | 'ownsTarget'
>;

async function evaluate<T>(session: LiveSession, expression: string): Promise<T> {
  const result = await session.cdp.send<{ result: { value: T } }>('Runtime.evaluate', {
    expression,
    returnByValue: true,
  }, { sessionId: session.sessionId });
  return result.result.value;
}

async function readSnapshot(session: LiveSession): Promise<BinanceArticleSnapshot> {
  const serialized = await evaluate<string>(session, `(() => {
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const first = (selectors) => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) return element;
      }
      return null;
    };
    const title = first(${JSON.stringify(BS_SELECTORS.articleTitleInput)});
    const editor = first(${JSON.stringify(BS_SELECTORS.articleEditor)});
    const buttons = Array.from(new Set(${JSON.stringify(BS_SELECTORS.articlePublishButton)}.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector)).filter(visible)
    )));
    const media = editor ? Array.from(editor.querySelectorAll('img')).filter(visible) : [];
    const covers = Array.from(document.querySelectorAll(
      '[data-testid*="cover" i] img, [class*="cover" i] img'
    )).filter((image) => visible(image) && !editor?.contains(image));
    const button = buttons.length === 1 ? buttons[0] : null;
    return JSON.stringify({
      url: window.location.href,
      title: title ? (title.value || title.textContent || '') : '',
      body: editor?.innerText || editor?.textContent || '',
      imageCount: media.length,
      mediaSources: media.map((image) => image.currentSrc || image.src || ''),
      coverSources: covers.map((image) => image.currentSrc || image.src || ''),
      editorVisible: Boolean(editor && visible(editor)),
      publishButtonCount: buttons.length,
      publishButtonEnabled: Boolean(button && !button.disabled && button.getAttribute('aria-disabled') !== 'true'),
    });
  })()`);
  return JSON.parse(serialized) as BinanceArticleSnapshot;
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trim();
}

function assertReady(
  snapshot: BinanceArticleSnapshot,
  expected: PreparedBinanceArticle & { mediaSources?: string[]; coverSources?: string[] },
): void {
  if (!snapshot.editorVisible) throw new Error('The prepared Binance article editor is no longer open.');
  if (normalizeText(snapshot.title) !== normalizeText(expected.expectedTitle)) {
    throw new Error('The Binance article title changed after preparation.');
  }
  if (normalizeText(snapshot.body) !== normalizeText(expected.expectedBody)) {
    throw new Error('The Binance article body changed after preparation.');
  }
  if (snapshot.imageCount !== expected.expectedImageCount) {
    throw new Error('The Binance article body images changed after preparation.');
  }
  if (snapshot.coverSources.length !== expected.expectedCoverCount) {
    throw new Error('The Binance article cover changed after preparation.');
  }
  if (expected.mediaSources && (
    snapshot.mediaSources.length !== expected.mediaSources.length
    || snapshot.mediaSources.some((source, index) => source !== expected.mediaSources?.[index])
  )) {
    throw new Error('The Binance article body images changed after preparation.');
  }
  if (expected.coverSources && (
    snapshot.coverSources.length !== expected.coverSources.length
    || snapshot.coverSources.some((source, index) => source !== expected.coverSources?.[index])
  )) {
    throw new Error('The Binance article cover changed after preparation.');
  }
  if (snapshot.publishButtonCount !== 1 || !snapshot.publishButtonEnabled) {
    throw new Error('The Binance article editor does not have exactly one enabled Publish button.');
  }
}

function liveDraft(id: string, session: LiveSession): BinanceArticleDraft {
  let closed = false;
  return {
    id,
    snapshot: () => readSnapshot(session),
    clickPublish: () => evaluate<boolean>(session, `(() => {
      const visible = (element) => element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
      const buttons = Array.from(new Set(${JSON.stringify(BS_SELECTORS.articlePublishButton)}.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector)).filter((button) =>
          visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true'
        )
      )));
      if (buttons.length !== 1) return false;
      buttons[0].click();
      return true;
    })()`),
    waitForPublishedUrl: async () => {
      const started = Date.now();
      while (Date.now() - started < 20_000) {
        const value = await evaluate<string>(session, 'window.location.href');
        if (canonicalBinancePublicationUrl(value, 'article')) return value;
        await sleep(500);
      }
      return undefined;
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await releaseBinanceArticleBrowserResource(session);
    },
  };
}

export function createLiveBinanceArticleDriver(): BinanceArticleDriver {
  return {
    async prepare(bundlePath: string): Promise<PreparedBinanceArticle> {
      const extracted = await extractV3PublicationBundle(bundlePath, {
        target: 'binance-square', kind: 'article',
      });
      const contextBox: { value: ArticleCompositionContext | null } = { value: null };
      let session: LiveSession | null = null;
      try {
        await publishArticle({
          markdownPath: extracted.contentPath,
          title: extracted.title,
          ...(extracted.coverPath ? { coverImage: extracted.coverPath } : {}),
          inferCoverFromFirstImage: false,
          submit: false,
          hashtags: true,
          coinTags: true,
          handoffBrowserSession: true,
          onComposed: async (prepared) => { contextBox.value = prepared; },
        });
        const context = contextBox.value;
        if (!context) throw new Error('The Binance article was composed without a review session.');
        session = context;
        contextBox.value = null;
        const snapshot = await readSnapshot(session);
        if (snapshot.imageCount !== extracted.imagePaths.length) {
          throw new Error('The Binance article body media does not match the reviewed bundle.');
        }
        const expectedCoverCount = extracted.coverPath ? 1 : 0;
        if (snapshot.coverSources.length !== expectedCoverCount) {
          throw new Error('The Binance article cover does not match the reviewed bundle.');
        }
        const draft = liveDraft(crypto.randomUUID(), session);
        session = null;
        return {
          draft,
          expectedTitle: extracted.title ?? '',
          expectedBody: context.bodyText,
          expectedImageCount: extracted.imagePaths.length,
          expectedCoverCount,
        };
      } finally {
        await rm(extracted.bundleDir, { recursive: true, force: true }).catch(() => undefined);
        if (session) await releaseBinanceArticleBrowserResource(session);
        if (contextBox.value) {
          await releaseBinanceArticleBrowserResource(contextBox.value).catch(() => undefined);
        }
      }
    },
  };
}

export class BaoyuBinanceArticleAdapter implements PublisherAdapter {
  readonly #driver: BinanceArticleDriver;
  readonly #drafts = new Map<string, PreparedBinanceArticle & {
    attempted: boolean;
    mediaSources: string[];
    coverSources: string[];
  }>();

  constructor(driver: BinanceArticleDriver = createLiveBinanceArticleDriver()) {
    this.#driver = driver;
  }

  async prepare(bundlePath: string): Promise<{ draftId: string }> {
    const prepared = await this.#driver.prepare(bundlePath);
    let snapshot: BinanceArticleSnapshot;
    try {
      snapshot = await prepared.draft.snapshot();
      assertReady(snapshot, prepared);
    } catch (error) {
      await prepared.draft.close().catch(() => undefined);
      throw error;
    }
    this.#drafts.set(prepared.draft.id, {
      ...prepared,
      attempted: false,
      mediaSources: [...snapshot.mediaSources],
      coverSources: [...snapshot.coverSources],
    });
    return { draftId: prepared.draft.id };
  }

  async publish(draftId: string, options: { beforeClick: () => Promise<void> }) {
    const prepared = this.#drafts.get(draftId);
    if (!prepared) throw new Error('The prepared Binance article draft was not found.');
    if (prepared.attempted) throw new Error('The Binance article publication was already attempted.');
    try {
      assertReady(await prepared.draft.snapshot(), prepared);
      prepared.attempted = true;
      await options.beforeClick();
      if (!await prepared.draft.clickPublish()) {
        throw new Error('The scoped Binance article Publish button was not found.');
      }
      const candidate = await prepared.draft.waitForPublishedUrl();
      const publishedUrl = candidate ? canonicalBinancePublicationUrl(candidate, 'article') : null;
      return publishedUrl
        ? { verified: true as const, reason: 'canonical Binance article navigation', publishedUrl }
        : { verified: true as const, reason: 'Binance did not expose a canonical article URL.' };
    } finally {
      this.#drafts.delete(draftId);
      await prepared.draft.close().catch(() => undefined);
    }
  }

  async discard(draftId: string): Promise<void> {
    const prepared = this.#drafts.get(draftId);
    this.#drafts.delete(draftId);
    await prepared?.draft.close().catch(() => undefined);
  }
}
