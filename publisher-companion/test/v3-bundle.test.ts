import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';
import JSZip from 'jszip';
import sharp from 'sharp';

import { sha256Hex } from '../src/asset-download';
import { materializeXPublicationBundle } from '../src/x-materialize';
import { extractV3PublicationBundle } from '../src/v3-bundle';

const files: string[] = [];

afterEach(async () => {
  await Promise.all(files.splice(0).map((file) => rm(file, { force: true })));
});

describe('V3 reviewed bundle validation', () => {
  it('rejects reordered article media metadata before browser composition', async () => {
    const image = new Uint8Array(await sharp({
      create: { width: 32, height: 18, channels: 3, background: 'blue' },
    }).png().toBuffer());
    const sha256 = await sha256Hex(image);
    const assets = ['asset_one', 'asset_two'].map((id) => ({
      id,
      mimeType: 'image/png' as const,
      sizeBytes: image.byteLength,
      sha256,
    }));
    const materialized = await materializeXPublicationBundle({
      recipe: {
        version: 3,
        target: 'x',
        kind: 'article',
        draftId: 'draft_1',
        articleId: 'article_1',
        revision: 1,
        expiresAt: '2026-08-16T01:00:00.000Z',
        title: 'Ordered media',
        markdown: '![One](asset:asset_one)\n\n![Two](asset:asset_two)',
        orderedAssetIds: assets.map((asset) => asset.id),
        assets,
      },
      expectedRevision: 1,
      now: new Date('2026-08-16T00:00:00.000Z'),
      downloadAsset: async () => image,
    });
    const zip = await JSZip.loadAsync(materialized.bundleBytes);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    manifest.images.reverse();
    zip.file('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    const bundlePath = join(tmpdir(), `v3-reordered-${crypto.randomUUID()}.zip`);
    files.push(bundlePath);
    await writeFile(bundlePath, await zip.generateAsync({ type: 'uint8array' }));

    await expect(extractV3PublicationBundle(bundlePath, {
      target: 'x', kind: 'article',
    })).rejects.toThrow(/invalid or duplicated/i);
  });

  it('rejects a bundle presented to an adapter for another target or kind', async () => {
    const materialized = await materializeXPublicationBundle({
      recipe: {
        version: 3,
        target: 'x',
        kind: 'post',
        draftId: 'draft_1',
        articleId: 'article_1',
        revision: 1,
        expiresAt: '2026-08-16T01:00:00.000Z',
        text: 'Reviewed post',
        orderedAssetIds: [],
        assets: [],
      },
      expectedRevision: 1,
      now: new Date('2026-08-16T00:00:00.000Z'),
      downloadAsset: async () => { throw new Error('no asset'); },
    });
    const bundlePath = join(tmpdir(), `v3-kind-${crypto.randomUUID()}.zip`);
    files.push(bundlePath);
    await writeFile(bundlePath, materialized.bundleBytes);

    await expect(extractV3PublicationBundle(bundlePath, {
      target: 'x', kind: 'article',
    })).rejects.toThrow(/target or kind/i);
  });

  it.each([
    ['reference-style image', '![Private][ref]\n\n[ref]: http://127.0.0.1/private.png'],
    ['raw HTML image', '<img src="/etc/private.png">'],
    ['Mermaid block', '```mermaid\ngraph TD; A-->B\n```'],
  ])('rejects a tampered X Article containing a %s at extraction', async (_label, markdown) => {
    const materialized = await materializeXPublicationBundle({
      recipe: {
        version: 3,
        target: 'x',
        kind: 'article',
        draftId: 'draft_1',
        articleId: 'article_1',
        revision: 1,
        expiresAt: '2026-08-16T01:00:00.000Z',
        title: 'Strict bundle boundary',
        markdown: 'Reviewed body.',
        orderedAssetIds: [],
        assets: [],
      },
      expectedRevision: 1,
      now: new Date('2026-08-16T00:00:00.000Z'),
      downloadAsset: async () => { throw new Error('no asset'); },
    });
    const zip = await JSZip.loadAsync(materialized.bundleBytes);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    const contentBytes = new TextEncoder().encode(markdown);
    manifest.content.bytes = contentBytes.byteLength;
    manifest.content.sha256 = await sha256Hex(contentBytes);
    zip.file('article.md', contentBytes);
    zip.file('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    const bundlePath = join(tmpdir(), `v3-unsafe-markdown-${crypto.randomUUID()}.zip`);
    files.push(bundlePath);
    await writeFile(bundlePath, await zip.generateAsync({ type: 'uint8array' }));

    let caught: unknown;
    let extractedDir: string | undefined;
    try {
      const extracted = await extractV3PublicationBundle(bundlePath, { target: 'x', kind: 'article' });
      extractedDir = extracted.bundleDir;
    } catch (error) {
      caught = error;
    } finally {
      if (extractedDir) await rm(extractedDir, { recursive: true, force: true });
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/image|markdown|mermaid/i);
  });
});
