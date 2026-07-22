import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, mock } from 'bun:test';
import JSZip from 'jszip';
import sharp from 'sharp';

import { validateXPostBundleArchive } from '../../.agents/skills/baoyu-post-to-x/scripts/bundle';

import { sha256Hex } from '../src/asset-download';
import { materializePublicationBundle } from '../src/materialize';
import { extractXPublicationBundle } from '../src/x-bundle';
import { materializeXPublicationBundle } from '../src/x-materialize';

describe('publication recipe materialization', () => {
  it('downloads a shared cover/body asset once and creates a validated local bundle', async () => {
    const image = new Uint8Array(await sharp({
      create: { width: 1200, height: 700, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).png().toBuffer());
    const hash = await sha256Hex(image);
    const downloadAsset = mock(async () => image);
    const recipe = {
      version: 1 as const,
      draftId: 'draft_1', articleId: 'article_1', revision: 3,
      expiresAt: '2026-07-19T00:15:00.000Z', title: 'Safe article',
      markdown: '## Body\n\n![Chart](asset:asset_1)',
      cover: { assetId: 'asset_1', focalX: 0.5, focalY: 0.5, targetWidth: 1000 as const, targetHeight: 400 as const },
      orderedAssetIds: ['asset_1'],
      assets: [{ id: 'asset_1', mimeType: 'image/png' as const, sizeBytes: image.byteLength, sha256: hash }],
    };

    const result = await materializePublicationBundle({
      recipe,
      expectedRevision: 3,
      now: new Date('2026-07-19T00:00:00.000Z'),
      downloadAsset,
      exportedAt: new Date('2026-07-19T00:00:00.000Z'),
    });

    expect(downloadAsset).toHaveBeenCalledTimes(1);
    expect(result.manifest.cover.width).toBe(1000);
    expect(result.manifest.cover.height).toBe(400);
    const zip = await JSZip.loadAsync(result.bundleBytes);
    expect(await zip.file('article.md')!.async('string')).toContain('(images/01-slide.png)');
    expect(zip.file('images/cover.jpg')).not.toBeNull();
  });

  it('rejects ordered assets that are missing or repeated in Markdown', async () => {
    const image = new Uint8Array(await sharp({
      create: { width: 10, height: 10, channels: 3, background: 'blue' },
    }).png().toBuffer());
    const hash = await sha256Hex(image);
    const base = {
      version: 1 as const, draftId: 'draft_1', articleId: 'article_1', revision: 3,
      expiresAt: '2026-07-19T00:15:00.000Z', title: 'Safe article',
      cover: { assetId: 'asset_1', focalX: 0.5, focalY: 0.5, targetWidth: 1000 as const, targetHeight: 400 as const },
      orderedAssetIds: ['asset_1'],
      assets: [{ id: 'asset_1', mimeType: 'image/png' as const, sizeBytes: image.byteLength, sha256: hash }],
    };
    for (const markdown of ['## Missing', '![One](asset:asset_1)\n![Two](asset:asset_1)']) {
      await expect(materializePublicationBundle({
        recipe: { ...base, markdown }, expectedRevision: 3,
        now: new Date('2026-07-19T00:00:00.000Z'), downloadAsset: async () => image,
      })).rejects.toThrow(/exactly once/i);
    }
  });

  it('accepts target-tagged V2 Binance recipes and rejects X recipes', async () => {
    const image = new Uint8Array(await sharp({
      create: { width: 1200, height: 700, channels: 3, background: 'blue' },
    }).png().toBuffer());
    const hash = await sha256Hex(image);
    const common = {
      version: 2 as const,
      draftId: 'draft_1', articleId: 'article_1', revision: 3,
      expiresAt: '2026-07-19T00:15:00.000Z',
    };
    const result = await materializePublicationBundle({
      recipe: {
        ...common,
        target: 'binance-square' as const,
        title: 'Safe article',
        markdown: '![Chart](asset:asset_1)',
        cover: {
          assetId: 'asset_1', focalX: 0.5, focalY: 0.5,
          targetWidth: 1000 as const, targetHeight: 400 as const,
        },
        orderedAssetIds: ['asset_1'],
        assets: [{
          id: 'asset_1', mimeType: 'image/png' as const,
          sizeBytes: image.byteLength, sha256: hash,
        }],
      },
      expectedRevision: 3,
      now: new Date('2026-07-19T00:00:00.000Z'),
      downloadAsset: async () => image,
    });
    expect(result.manifest.articleId).toBe('article_1');

    await expect(materializePublicationBundle({
      recipe: {
        ...common,
        target: 'x' as const,
        text: 'A reviewed X post.',
        orderedAssetIds: [],
        assets: [],
      },
      expectedRevision: 3,
      now: new Date('2026-07-19T00:00:00.000Z'),
      downloadAsset: async () => image,
    })).rejects.toThrow(/target does not match Binance Square/i);
  });
});

describe('X publication recipe materialization', () => {
  it('creates the reviewed X bundle contract from a V2 X recipe', async () => {
    const image = new Uint8Array(await sharp({
      create: { width: 1200, height: 700, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).png().toBuffer());
    const hash = await sha256Hex(image);
    const downloadAsset = mock(async () => image);
    const recipe = {
      version: 2 as const,
      target: 'x' as const,
      draftId: 'draft_1', articleId: 'article_1', revision: 3,
      expiresAt: '2026-07-19T00:15:00.000Z',
      text: 'A reviewed X post.',
      orderedAssetIds: ['asset_1'],
      assets: [{
        id: 'asset_1', mimeType: 'image/png' as const,
        sizeBytes: image.byteLength, sha256: hash,
      }],
    };

    const result = await materializeXPublicationBundle({
      recipe,
      expectedRevision: 3,
      now: new Date('2026-07-19T00:00:00.000Z'),
      exportedAt: new Date('2026-07-19T00:01:00.000Z'),
      downloadAsset,
    });

    expect(downloadAsset).toHaveBeenCalledTimes(1);
    const zip = await JSZip.loadAsync(result.bundleBytes);
    expect(await zip.file('post.txt')!.async('string')).toBe('A reviewed X post.');
    expect(zip.file('images/01-post.png')).not.toBeNull();
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      source: 'xarticle',
      platform: 'x',
      kind: 'post',
      articleId: 'article_1',
      images: [{ path: 'images/01-post.png', order: 0, slideId: 'asset_1' }],
    });

    const bundlePath = join(tmpdir(), `publisher-x-${crypto.randomUUID()}.zip`);
    try {
      await writeFile(bundlePath, result.bundleBytes);
      await expect(validateXPostBundleArchive(bundlePath)).resolves.toMatchObject({
        text: 'A reviewed X post.',
        manifest: { platform: 'x', kind: 'post' },
      });
      const extracted = await extractXPublicationBundle(bundlePath);
      try {
        expect(extracted.text).toBe('A reviewed X post.');
        expect(extracted.imagePaths).toHaveLength(1);
      } finally {
        await rm(extracted.bundleDir, { recursive: true, force: true });
      }
    } finally {
      await rm(bundlePath, { force: true });
    }
  });

  it('counts the 280-character limit by Unicode code points in materialized and extracted bundles', async () => {
    const text = '🚀'.repeat(280);
    const downloadAsset = mock(async () => new Uint8Array([1]));
    const recipe = {
      version: 2 as const,
      target: 'x' as const,
      draftId: 'draft_emoji', articleId: 'article_emoji', revision: 3,
      expiresAt: '2026-07-19T00:15:00.000Z',
      text,
      orderedAssetIds: [],
      assets: [],
    };
    const result = await materializeXPublicationBundle({
      recipe,
      expectedRevision: 3,
      now: new Date('2026-07-19T00:00:00.000Z'),
      exportedAt: new Date('2026-07-19T00:01:00.000Z'),
      downloadAsset,
    });

    const bundlePath = join(tmpdir(), `publisher-x-emoji-${crypto.randomUUID()}.zip`);
    try {
      await writeFile(bundlePath, result.bundleBytes);
      const extracted = await extractXPublicationBundle(bundlePath);
      try {
        expect(extracted.text).toBe(text);
        expect([...extracted.text]).toHaveLength(280);
      } finally {
        await rm(extracted.bundleDir, { recursive: true, force: true });
      }
    } finally {
      await rm(bundlePath, { force: true });
    }
    expect(downloadAsset).not.toHaveBeenCalled();

    await expect(materializeXPublicationBundle({
      recipe: { ...recipe, text: '🚀'.repeat(281) },
      expectedRevision: 3,
      now: new Date('2026-07-19T00:00:00.000Z'),
      downloadAsset,
    })).rejects.toThrow();
  });

  it('rejects non-X recipes and enforces the 280-character/four-image limits before download', async () => {
    const downloadAsset = mock(async () => new Uint8Array([1]));
    const common = {
      draftId: 'draft_1', articleId: 'article_1', revision: 3,
      expiresAt: '2026-07-19T00:15:00.000Z',
    };
    const legacyBinanceRecipe = {
      ...common,
      version: 1 as const,
      title: 'Legacy Binance article',
      markdown: '![Chart](asset:asset_1)',
      cover: {
        assetId: 'asset_1', focalX: 0.5, focalY: 0.5,
        targetWidth: 1000 as const, targetHeight: 400 as const,
      },
      orderedAssetIds: ['asset_1'],
      assets: [{
        id: 'asset_1', mimeType: 'image/png' as const,
        sizeBytes: 1, sha256: 'a'.repeat(64),
      }],
    };

    await expect(materializeXPublicationBundle({
      recipe: legacyBinanceRecipe,
      expectedRevision: 3,
      now: new Date('2026-07-19T00:00:00.000Z'),
      downloadAsset,
    })).rejects.toThrow(/target does not match X/i);

    await expect(materializeXPublicationBundle({
      recipe: {
        ...common,
        version: 2 as const,
        target: 'x' as const,
        text: 'x'.repeat(281),
        orderedAssetIds: [],
        assets: [],
      },
      expectedRevision: 3,
      now: new Date('2026-07-19T00:00:00.000Z'),
      downloadAsset,
    })).rejects.toThrow();

    const assets = Array.from({ length: 5 }, (_, index) => ({
      id: `asset_${index + 1}`,
      mimeType: 'image/png' as const,
      sizeBytes: 1,
      sha256: 'a'.repeat(64),
    }));
    await expect(materializeXPublicationBundle({
      recipe: {
        ...common,
        version: 2 as const,
        target: 'x' as const,
        text: '',
        orderedAssetIds: assets.map((asset) => asset.id),
        assets,
      },
      expectedRevision: 3,
      now: new Date('2026-07-19T00:00:00.000Z'),
      downloadAsset,
    })).rejects.toThrow();
    expect(downloadAsset).not.toHaveBeenCalled();
  });
});
