import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';

import {
  readXArticleEditorSnapshot,
  type XArticleCompositionContext,
} from '../../.agents/skills/baoyu-post-to-x/scripts/x-article';
import type { XArticlePublishGuard } from '../src/x-article-adapter';
import { createManagedXArticleDraft } from '../src/x-article-live-composer';

function managedPageCdp(page: Page) {
  return {
    async send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
      if (method === 'Page.getFrameTree') {
        return { frameTree: { frame: { id: 'main-frame' } } } as T;
      }
      if (method === 'Runtime.evaluate' && typeof params?.expression === 'string') {
        const value = await page.evaluate(
          async (expression) => await (0, eval)(expression),
          params.expression,
        );
        return { result: { value } } as T;
      }
      throw new Error(`Unexpected synthetic CDP method: ${method}`);
    },
    on() { return () => undefined; },
    close() {},
  };
}

async function installArticleEditor(page: Page): Promise<void> {
  await page.setContent(`
    <style>
      main, textarea, [data-contents="true"], [data-block="true"], img, button {
        display: block; width: 200px; min-height: 20px;
      }
      img { width: 20px; height: 20px; }
    </style>
    <main>
      <textarea placeholder="Add a title">Reviewed title</textarea>
      <div class="DraftEditor-editorContainer">
        <div data-contents="true">
          <div id="before" data-block="true" data-editor="editor-a" data-offset-key="before-0-0">Before image.</div>
          <div id="media" data-block="true" data-editor="editor-a" data-offset-key="media-a-0-0"><img alt=""></div>
          <div id="after" data-block="true" data-editor="editor-a" data-offset-key="after-0-0">After image.</div>
        </div>
      </div>
      <button data-testid="publishButton">Publish</button>
    </main>
  `);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#f0b90b';
    context.fillRect(0, 0, 8, 8);
    const image = document.querySelector<HTMLImageElement>('#media img')!;
    image.src = canvas.toDataURL('image/png');
    await image.decode();
    document.querySelector('[data-testid="publishButton"]')!.addEventListener('click', () => {
      document.body.dataset.publishClicks = String(Number(document.body.dataset.publishClicks ?? 0) + 1);
    });
  });
}

describe('managed X Article atomic click', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => { browser = await chromium.launch(); });
  beforeEach(async () => { page = await browser.newPage(); });
  afterEach(async () => { await page.close(); });
  afterAll(async () => { await browser.close(); });

  it('rejects an unchanged media block moved to another reviewed text position', async () => {
    await installArticleEditor(page);
    const cdp = managedPageCdp(page);
    const snapshot = await readXArticleEditorSnapshot(cdp, 'managed-session');
    const media = snapshot.bodySequence.find((token) => token.kind === 'media');
    if (media?.kind !== 'media') throw new Error('Synthetic reviewed media was unavailable.');
    const context = {
      cdp,
      sessionId: 'managed-session',
      targetId: 'managed-target',
      ownsBrowser: false,
      ownsTarget: false,
      title: snapshot.title,
      body: snapshot.body,
      expectedBody: snapshot.body,
      imageCount: 1,
      coverPresent: false,
      reviewedBodySequence: [
        { kind: 'text', text: 'Before image.' },
        { kind: 'media', assetId: 'reviewed-asset-a' },
        { kind: 'text', text: 'After image.' },
      ],
      mediaBindings: [{
        blockId: media.blockId,
        assetId: 'reviewed-asset-a',
        fingerprint: media.fingerprint,
      }],
    } as unknown as XArticleCompositionContext;
    const guard = {
      url: snapshot.url,
      editorId: snapshot.editorId,
      title: snapshot.title,
      body: snapshot.body,
      bodySequence: snapshot.bodySequence,
      imageCount: 1,
      mediaSources: [`${media.blockId}:reviewed-asset-a`],
      bodyMediaDomSources: [...snapshot.mediaSources],
      coverSource: null,
      coverSources: [],
      coverDomSources: [],
      editorVisible: true,
      publishButtonCount: 1,
      publishButtonEnabled: true,
    } as XArticlePublishGuard & { bodySequence: typeof snapshot.bodySequence };
    const draft = createManagedXArticleDraft('managed-draft', context);

    await page.evaluate(() => {
      document.querySelector('[data-contents="true"]')!.append(document.querySelector('#media')!);
    });

    try {
      await expect(draft.clickPublish(guard)).rejects.toThrow(/changed|sequence|position/i);
      expect(await page.evaluate(() => Number(document.body.dataset.publishClicks ?? 0))).toBe(0);
    } finally {
      await draft.close();
    }
  });
});
