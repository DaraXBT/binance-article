import type { PublisherAdapter } from './skill-adapter';
import { canonicalXArticleUrl } from './skill-adapter';
import { createLiveXArticleDriver } from './x-article-live-composer';

export type XArticleAbortCode = 'X_LOGIN_REQUIRED' | 'X_ARTICLES_UNAVAILABLE';

export class XArticleEligibilityError extends Error {
  readonly code: XArticleAbortCode;

  constructor(code: XArticleAbortCode) {
    super(code === 'X_LOGIN_REQUIRED'
      ? 'Log in to X before preparing an Article.'
      : 'X Articles are unavailable for this account.');
    this.name = 'XArticleEligibilityError';
    this.code = code;
  }
}

export type XArticleSnapshot = {
  url: string;
  editorId: string;
  title: string;
  body: string;
  imageCount: number;
  mediaSources: string[];
  bodyMediaDomSources?: string[];
  coverSource: string | null;
  coverSources: string[];
  coverDomSources?: string[];
  editorVisible: boolean;
  publishButtonCount: number;
  publishButtonEnabled: boolean;
};

export type XArticlePublishGuard = XArticleSnapshot;

export type XArticleDraft = {
  id: string;
  snapshot(): Promise<XArticleSnapshot>;
  clickPublish(guard: XArticlePublishGuard): Promise<boolean>;
  waitForPublishedUrl(): Promise<string | undefined>;
  close(): Promise<void>;
};

export type PreparedXArticle = {
  draft: XArticleDraft;
  expectedTitle: string;
  expectedBody: string;
  expectedImageCount: number;
  expectedCover: boolean;
};

export type XArticleDriver = {
  prepare(bundlePath: string): Promise<PreparedXArticle>;
};

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trim();
}

function normalizeReviewedBody(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function assertReady(
  snapshot: XArticleSnapshot,
  expected: PreparedXArticle & {
    bodySnapshot?: string;
    mediaSources?: readonly string[];
    coverSource?: string | null;
    coverSources?: readonly string[];
    editorId?: string;
    draftUrl?: string;
  },
): void {
  if (!snapshot.editorVisible) throw new Error('The prepared X Article editor is no longer open.');
  if (expected.editorId !== undefined && snapshot.editorId !== expected.editorId) {
    throw new Error('The prepared X Article editor was replaced after preparation.');
  }
  if (expected.draftUrl !== undefined && snapshot.url !== expected.draftUrl) {
    throw new Error('The prepared X Article draft URL changed after preparation.');
  }
  if (normalizeText(snapshot.title) !== normalizeText(expected.expectedTitle)) {
    throw new Error('The X Article title changed after preparation.');
  }
  if (
    normalizeReviewedBody(snapshot.body) !== normalizeReviewedBody(expected.expectedBody)
    || (expected.bodySnapshot !== undefined && normalizeText(snapshot.body) !== expected.bodySnapshot)
  ) {
    throw new Error('The X Article body changed after preparation.');
  }
  if (snapshot.imageCount !== expected.expectedImageCount) {
    throw new Error(`The X Article has ${snapshot.imageCount} body images; expected ${expected.expectedImageCount}.`);
  }
  if (expected.mediaSources && (
    snapshot.mediaSources.length !== expected.mediaSources.length
    || snapshot.mediaSources.some((source, index) => source !== expected.mediaSources?.[index])
  )) {
    throw new Error('The X Article body images changed after preparation.');
  }
  if (Boolean(snapshot.coverSource) !== expected.expectedCover) {
    throw new Error('The X Article cover changed after preparation.');
  }
  if (snapshot.coverSources.length !== (expected.expectedCover ? 1 : 0)) {
    throw new Error('The X Article cover changed after preparation.');
  }
  if (expected.coverSource !== undefined && snapshot.coverSource !== expected.coverSource) {
    throw new Error('The X Article cover changed after preparation.');
  }
  if (expected.coverSources && (
    snapshot.coverSources.length !== expected.coverSources.length
    || snapshot.coverSources.some((source, index) => source !== expected.coverSources?.[index])
  )) {
    throw new Error('The X Article cover changed after preparation.');
  }
  if (snapshot.publishButtonCount !== 1 || !snapshot.publishButtonEnabled) {
    throw new Error('The X Article editor does not have exactly one enabled Publish button.');
  }
}

export class BaoyuXArticleAdapter implements PublisherAdapter {
  readonly #driver: XArticleDriver;
  readonly #drafts = new Map<string, PreparedXArticle & {
    attempted: boolean;
    bodySnapshot: string;
    mediaSources: string[];
    coverSource: string | null;
    coverSources: string[];
    editorId: string;
    draftUrl: string;
  }>();

  constructor(driver: XArticleDriver = createLiveXArticleDriver()) {
    this.#driver = driver;
  }

  async prepare(bundlePath: string): Promise<{ draftId: string }> {
    const prepared = await this.#driver.prepare(bundlePath);
    let snapshot: XArticleSnapshot;
    try {
      snapshot = await prepared.draft.snapshot();
      assertReady(snapshot, prepared);
    } catch (error) {
      await prepared.draft.close().catch(() => undefined);
      throw error;
    }
    if (this.#drafts.has(prepared.draft.id)) {
      await prepared.draft.close().catch(() => undefined);
      throw new Error('The X Article editor returned a duplicate draft ID.');
    }
    this.#drafts.set(prepared.draft.id, {
      ...prepared,
      attempted: false,
      bodySnapshot: normalizeText(snapshot.body),
      mediaSources: [...snapshot.mediaSources],
      coverSource: snapshot.coverSource,
      coverSources: [...snapshot.coverSources],
      editorId: snapshot.editorId,
      draftUrl: snapshot.url,
    });
    return { draftId: prepared.draft.id };
  }

  async publish(
    draftId: string,
    options: { beforeClick: () => Promise<void> },
  ): Promise<{ verified: true; reason: string; publishedUrl?: string }> {
    const prepared = this.#drafts.get(draftId);
    if (!prepared) throw new Error('The prepared X Article draft was not found.');
    if (prepared.attempted) throw new Error('The X Article publication was already attempted.');
    try {
      assertReady(await prepared.draft.snapshot(), {
        ...prepared,
        mediaSources: prepared.mediaSources,
        coverSource: prepared.coverSource,
        coverSources: prepared.coverSources,
      });
      prepared.attempted = true;
      await options.beforeClick();
      const finalSnapshot = await prepared.draft.snapshot();
      assertReady(finalSnapshot, {
        ...prepared,
        mediaSources: prepared.mediaSources,
        coverSource: prepared.coverSource,
        coverSources: prepared.coverSources,
      });
      if (!await prepared.draft.clickPublish(finalSnapshot)) {
        throw new Error('The scoped X Article Publish button was not found.');
      }
      const candidate = await prepared.draft.waitForPublishedUrl();
      const publishedUrl = candidate ? canonicalXArticleUrl(candidate) : null;
      if (!publishedUrl) {
        throw new Error('X did not expose canonical Article publication evidence.');
      }
      return { verified: true, reason: 'canonical X Article navigation', publishedUrl };
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
