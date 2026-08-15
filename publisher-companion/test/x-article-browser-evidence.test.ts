import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';

import {
  readXArticleEditorSnapshot,
  xArticleImageFingerprintsMatch,
} from '../../.agents/skills/baoyu-post-to-x/scripts/x-article';

function pageBackedCdp(page: Page) {
  return {
    async send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
      if (method !== 'Runtime.evaluate' || typeof params?.expression !== 'string') {
        throw new Error(`Unexpected synthetic CDP method: ${method}`);
      }
      const value = await page.evaluate(async (expression) => await (0, eval)(expression), params.expression);
      return { result: { value } } as T;
    },
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
    <main id="article-editor">
      <textarea placeholder="Add a title">Reviewed title</textarea>
      <div class="DraftEditor-editorContainer">
        <div data-contents="true">
          <div data-block="true" data-editor="editor-a" data-offset-key="4g3nm-0-0">Before image.</div>
          <div data-block="true" data-editor="editor-a" data-offset-key="a1b2c-0-0"><img id="body-image" alt=""></div>
          <div data-block="true" data-editor="editor-a" data-offset-key="9uv-0-0">After image.</div>
        </div>
      </div>
      <button data-testid="publishButton">Publish</button>
    </main>
    <aside>
      <div data-block="true" data-editor="sidebar" data-offset-key="side1-0-0">
        <img id="off-editor-image" alt="">
      </div>
    </aside>
  `);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#f0b90b';
    context.fillRect(0, 0, 8, 8);
    context.fillStyle = '#111827';
    context.fillRect(0, 0, 4, 4);
    const source = canvas.toDataURL('image/png');
    const images = [
      document.querySelector<HTMLImageElement>('#body-image')!,
      document.querySelector<HTMLImageElement>('#off-editor-image')!,
    ];
    for (const image of images) {
      image.src = source;
      await image.decode();
    }
  });
}

describe('X Article browser evidence', () => {
  let browser: Browser;
  let page: Page;
  let imageServer: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    browser = await chromium.launch();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    imageServer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response(png, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'image/png',
        },
      }),
    });
  });
  beforeEach(async () => { page = await browser.newPage(); });
  afterEach(async () => { await page.close(); });
  afterAll(async () => {
    imageServer.stop(true);
    await browser.close();
  });

  it('is editor-scoped, ordered, and source-scheme agnostic', async () => {
    await installArticleEditor(page);

    const snapshot = await readXArticleEditorSnapshot(pageBackedCdp(page), 'synthetic-session');

    expect(snapshot.title).toBe('Reviewed title');
    expect(snapshot.mediaSources).toHaveLength(1);
    expect(snapshot.mediaSources[0]).toMatch(/^data:image\/png;base64,/);
    expect(snapshot.bodySequence.map((token) => token.kind)).toEqual(['text', 'media', 'text']);
    expect(snapshot.bodySequence[1]).toMatchObject({ kind: 'media', blockId: 'a1b2c' });
    expect(snapshot.publishButtonCount).toBe(1);
    expect(snapshot.publishButtonEnabled).toBe(true);
  });

  it('rejects two visible editor surfaces', async () => {
    await installArticleEditor(page);
    await page.evaluate(() => {
      const duplicate = document.querySelector('main')!.cloneNode(true) as HTMLElement;
      duplicate.id = 'duplicate-editor';
      duplicate.querySelectorAll('[data-editor]').forEach((block) => block.setAttribute('data-editor', 'editor-b'));
      document.body.append(duplicate);
    });

    await expect(readXArticleEditorSnapshot(pageBackedCdp(page), 'synthetic-session'))
      .rejects.toThrow(/missing or ambiguous/i);
  });

  it('rejects unowned media inside the selected body', async () => {
    await installArticleEditor(page);
    await page.evaluate(async () => {
      const unowned = document.createElement('div');
      unowned.setAttribute('data-block', 'true');
      unowned.setAttribute('data-offset-key', 'ownerless-0-0');
      const image = document.createElement('img');
      image.style.cssText = 'display:block;width:20px;height:20px';
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      canvas.getContext('2d')!.fillRect(0, 0, 4, 4);
      image.src = canvas.toDataURL('image/png');
      unowned.append(image);
      document.querySelector('[data-contents="true"]')!.append(unowned);
      await image.decode();
    });

    await expect(readXArticleEditorSnapshot(pageBackedCdp(page), 'synthetic-session'))
      .rejects.toThrow(/owner|editor|unaccounted/i);
  });

  it('preserves two visible cover nodes sharing one source', async () => {
    await installArticleEditor(page);
    await page.evaluate(async () => {
      const cover = document.createElement('div');
      cover.dataset.testid = 'cover-media';
      const source = (document.querySelector('#body-image') as HTMLImageElement).src;
      for (let index = 0; index < 2; index++) {
        const image = document.createElement('img');
        image.style.cssText = 'display:block;width:20px;height:20px';
        image.src = source;
        cover.append(image);
        await image.decode();
      }
      document.querySelector('main')!.append(cover);
    });

    const snapshot = await readXArticleEditorSnapshot(pageBackedCdp(page), 'synthetic-session');
    expect(snapshot.coverSources).toHaveLength(2);
  });

  it('includes transparency in decoded image identity', async () => {
    await installArticleEditor(page);
    const setBlackImage = async (alpha: number) => {
      await page.evaluate(async (nextAlpha) => {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const context = canvas.getContext('2d')!;
        context.fillStyle = `rgba(0, 0, 0, ${nextAlpha})`;
        context.fillRect(0, 0, 8, 8);
        const image = document.querySelector<HTMLImageElement>('#body-image')!;
        image.src = canvas.toDataURL('image/png');
        await image.decode();
      }, alpha);
    };

    await setBlackImage(1);
    const opaque = await readXArticleEditorSnapshot(pageBackedCdp(page), 'synthetic-session');
    await setBlackImage(0);
    const transparent = await readXArticleEditorSnapshot(pageBackedCdp(page), 'synthetic-session');

    const opaqueMedia = opaque.bodySequence.find((token) => token.kind === 'media');
    const transparentMedia = transparent.bodySequence.find((token) => token.kind === 'media');
    expect(opaqueMedia?.kind).toBe('media');
    expect(transparentMedia?.kind).toBe('media');
    if (opaqueMedia?.kind !== 'media' || transparentMedia?.kind !== 'media') {
      throw new Error('Synthetic X Article media fingerprint was unavailable.');
    }
    expect(xArticleImageFingerprintsMatch(
      opaqueMedia.fingerprint,
      transparentMedia.fingerprint,
    )).toBe(false);
  });

  it('fingerprints a CORS-capable CDN image even when the rendered node taints canvas', async () => {
    await installArticleEditor(page);
    await page.evaluate(async (source) => {
      const image = document.querySelector<HTMLImageElement>('#body-image')!;
      image.removeAttribute('crossorigin');
      image.src = source;
      await image.decode();
    }, `http://127.0.0.1:${imageServer.port}/cdn-image.png`);

    const snapshot = await readXArticleEditorSnapshot(pageBackedCdp(page), 'synthetic-session');
    const media = snapshot.bodySequence.find((token) => token.kind === 'media');
    expect(media?.kind).toBe('media');
    if (media?.kind !== 'media') throw new Error('Synthetic CDN media fingerprint was unavailable.');
    expect(media.fingerprint.colorSamples.length).toBeGreaterThan(0);
  });
});
