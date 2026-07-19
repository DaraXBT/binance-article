import { describe, expect, it, mock } from 'bun:test';
import JSZip from 'jszip';
import sharp from 'sharp';

import { sha256Hex } from '../src/asset-download';
import { materializePublicationBundle } from '../src/materialize';

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
});
