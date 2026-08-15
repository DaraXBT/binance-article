import type { PublisherAdapter } from './skill-adapter';
import { canonicalBinancePublicationUrl } from './skill-adapter';
import { createLiveBinancePostDriver } from './binance-post-live-composer';

export type BinancePostSnapshot = {
  url: string;
  text: string;
  imageCount: number;
  mediaSources: string[];
  editorVisible: boolean;
  publishButtonCount: number;
  publishButtonEnabled: boolean;
};

export type BinancePostDraft = {
  id: string;
  snapshot(): Promise<BinancePostSnapshot>;
  clickPublish(): Promise<boolean>;
  waitForPublishedUrl(): Promise<string | undefined>;
  close(): Promise<void>;
};

export type PreparedBinancePost = {
  draft: BinancePostDraft;
  expectedText: string;
  expectedImageCount: number;
};

export type BinancePostDriver = {
  prepare(bundlePath: string): Promise<PreparedBinancePost>;
};

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trim();
}

function assertReady(
  snapshot: BinancePostSnapshot,
  expected: { expectedText: string; expectedImageCount: number; mediaSources?: readonly string[] },
): void {
  if (!snapshot.editorVisible) throw new Error('The prepared Binance post composer is no longer open.');
  if (normalizeText(snapshot.text) !== normalizeText(expected.expectedText)) {
    throw new Error('The Binance post text changed after preparation.');
  }
  if (snapshot.imageCount !== expected.expectedImageCount) {
    throw new Error(`The Binance post has ${snapshot.imageCount} images; expected ${expected.expectedImageCount}.`);
  }
  if (expected.mediaSources && (
    snapshot.mediaSources.length !== expected.mediaSources.length
    || snapshot.mediaSources.some((source, index) => source !== expected.mediaSources?.[index])
  )) {
    throw new Error('The Binance post images changed after preparation.');
  }
  if (snapshot.publishButtonCount !== 1 || !snapshot.publishButtonEnabled) {
    throw new Error('The Binance post composer does not have exactly one enabled Publish button.');
  }
}

export class BaoyuBinancePostAdapter implements PublisherAdapter {
  readonly #driver: BinancePostDriver;
  readonly #drafts = new Map<string, PreparedBinancePost & {
    attempted: boolean;
    expectedMediaSources: string[];
  }>();

  constructor(driver: BinancePostDriver = createLiveBinancePostDriver()) {
    this.#driver = driver;
  }

  async prepare(bundlePath: string): Promise<{ draftId: string }> {
    const prepared = await this.#driver.prepare(bundlePath);
    let snapshot: BinancePostSnapshot;
    try {
      snapshot = await prepared.draft.snapshot();
      assertReady(snapshot, prepared);
    } catch (error) {
      await prepared.draft.close().catch(() => undefined);
      throw error;
    }
    if (this.#drafts.has(prepared.draft.id)) {
      await prepared.draft.close().catch(() => undefined);
      throw new Error('The Binance post composer returned a duplicate draft ID.');
    }
    this.#drafts.set(prepared.draft.id, {
      ...prepared,
      attempted: false,
      expectedMediaSources: [...snapshot.mediaSources],
    });
    return { draftId: prepared.draft.id };
  }

  async publish(
    draftId: string,
    options: { beforeClick: () => Promise<void> },
  ): Promise<{ verified: true; reason: string; publishedUrl?: string }> {
    const prepared = this.#drafts.get(draftId);
    if (!prepared) throw new Error('The prepared Binance post draft was not found.');
    if (prepared.attempted) throw new Error('The Binance post publication was already attempted.');
    try {
      assertReady(await prepared.draft.snapshot(), {
        ...prepared,
        mediaSources: prepared.expectedMediaSources,
      });
      prepared.attempted = true;
      await options.beforeClick();
      if (!await prepared.draft.clickPublish()) {
        throw new Error('The scoped Binance post Publish button was not found.');
      }
      const candidate = await prepared.draft.waitForPublishedUrl();
      const publishedUrl = candidate
        ? canonicalBinancePublicationUrl(candidate, 'post')
        : null;
      return publishedUrl
        ? { verified: true, reason: 'canonical Binance post navigation', publishedUrl }
        : { verified: true, reason: 'Binance did not expose a canonical post URL.' };
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
