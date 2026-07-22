import type { PublisherAdapter } from './skill-adapter';
import { canonicalXStatusUrl } from './skill-adapter';
import { createLiveXComposerDriver } from './x-live-composer';

export type XComposerSnapshot = {
  url: string;
  text: string;
  imageCount: number;
  mediaSources: string[];
  editorVisible: boolean;
  postButtonCount: number;
  postButtonEnabled: boolean;
};

export type XComposerDraft = {
  id: string;
  snapshot(): Promise<XComposerSnapshot>;
  clickPost(): Promise<boolean>;
  waitForPublishedUrl(): Promise<string | undefined>;
  close(): Promise<void>;
};

export type PreparedXComposerDraft = {
  draft: XComposerDraft;
  expectedText: string;
  expectedImageCount: number;
};

export type XComposerDriver = {
  prepare(bundlePath: string): Promise<PreparedXComposerDraft>;
};

function normalizedText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trim();
}

function assertReady(
  snapshot: XComposerSnapshot,
  expected: { text: string; imageCount: number; mediaSources?: readonly string[] },
): void {
  if (!snapshot.editorVisible) throw new Error('The prepared X composer is no longer open.');
  if (normalizedText(snapshot.text) !== normalizedText(expected.text)) {
    throw new Error('The X draft text changed after preparation.');
  }
  if (snapshot.imageCount !== expected.imageCount) {
    throw new Error(`The X draft has ${snapshot.imageCount} images; expected ${expected.imageCount}.`);
  }
  if (expected.mediaSources && (
    snapshot.mediaSources.length !== expected.mediaSources.length
    || snapshot.mediaSources.some((source, index) => source !== expected.mediaSources?.[index])
  )) {
    throw new Error('The X draft images changed after preparation.');
  }
  if (snapshot.postButtonCount !== 1 || !snapshot.postButtonEnabled) {
    throw new Error('The X composer does not have exactly one enabled Post button.');
  }
}

export class BaoyuXSkillAdapter implements PublisherAdapter {
  readonly #driver: XComposerDriver;
  readonly #drafts = new Map<string, PreparedXComposerDraft & {
    attempted: boolean;
    expectedMediaSources: string[];
  }>();

  constructor(driver: XComposerDriver = createLiveXComposerDriver()) {
    this.#driver = driver;
  }

  async prepare(bundlePath: string): Promise<{ draftId: string }> {
    const prepared = await this.#driver.prepare(bundlePath);
    let snapshot: XComposerSnapshot;
    try {
      snapshot = await prepared.draft.snapshot();
      assertReady(snapshot, {
        text: prepared.expectedText,
        imageCount: prepared.expectedImageCount,
      });
    } catch (error) {
      await prepared.draft.close().catch(() => undefined);
      throw error;
    }
    if (this.#drafts.has(prepared.draft.id)) {
      await prepared.draft.close().catch(() => undefined);
      throw new Error('The X composer returned a duplicate draft ID.');
    }
    this.#drafts.set(prepared.draft.id, {
      ...prepared,
      expectedMediaSources: [...snapshot.mediaSources],
      attempted: false,
    });
    return { draftId: prepared.draft.id };
  }

  async publish(
    draftId: string,
    options: { beforeClick: () => Promise<void> },
  ): Promise<{ verified: true; reason: string; publishedUrl?: string }> {
    const prepared = this.#drafts.get(draftId);
    if (!prepared) throw new Error('The prepared X draft was not found.');
    if (prepared.attempted) throw new Error('The X draft publication was already attempted.');

    try {
      assertReady(await prepared.draft.snapshot(), {
        text: prepared.expectedText,
        imageCount: prepared.expectedImageCount,
        mediaSources: prepared.expectedMediaSources,
      });
      prepared.attempted = true;
      await options.beforeClick();
      if (!await prepared.draft.clickPost()) {
        throw new Error('The scoped X Post button was not found.');
      }
      const candidate = await prepared.draft.waitForPublishedUrl();
      const publishedUrl = candidate ? canonicalXStatusUrl(candidate) : null;
      return publishedUrl
        ? { verified: true, reason: 'canonical X status navigation', publishedUrl }
        : { verified: true, reason: 'X did not expose a canonical status URL.' };
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
