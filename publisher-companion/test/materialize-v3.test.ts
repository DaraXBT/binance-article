import { describe, expect, it, mock } from 'bun:test';
import JSZip from 'jszip';
import sharp from 'sharp';

import { sha256Hex } from '../src/asset-download';
import { materializePublicationBundle } from '../src/materialize';
import { materializeXPublicationBundle } from '../src/x-materialize';

const now = new Date('2026-07-19T00:00:00.000Z');
const exportedAt = new Date('2026-07-19T00:01:00.000Z');

function common(target: 'binance-square' | 'x', kind: 'post' | 'article') {
  return {
    version: 3 as const,
    target,
    kind,
    draftId: `draft_${target}_${kind}`.replaceAll('-', '_'),
    articleId: 'article_1',
    revision: 3,
    expiresAt: '2026-07-19T00:15:00.000Z',
    orderedAssetIds: [],
    assets: [],
  };
}

async function unzip(bytes: Uint8Array) {
  return JSZip.loadAsync(bytes);
}

describe('V3 zero-asset publication materialization', () => {
  it.each([
    ['x', materializeXPublicationBundle],
    ['binance-square', materializePublicationBundle],
  ] as const)('materializes a text-only %s post without an asset download', async (target, materialize) => {
    const downloadAsset = mock(async () => {
      throw new Error('A text-only post must not download an asset.');
    });
    const result = await materialize({
      recipe: { ...common(target, 'post'), text: 'A reviewed text-only post.' },
      expectedRevision: 3,
      now,
      exportedAt,
      downloadAsset,
    });

    expect(downloadAsset).not.toHaveBeenCalled();
    const zip = await unzip(result.bundleBytes);
    expect(await zip.file('post.txt')?.async('string')).toBe('A reviewed text-only post.');
    expect(Object.keys(zip.files).some((path) => path.startsWith('images/'))).toBe(false);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest).toMatchObject({ platform: target, kind: 'post', images: [] });
  });

  it.each([
    ['x', materializeXPublicationBundle],
    ['binance-square', materializePublicationBundle],
  ] as const)('materializes a media-free %s article without inferring a cover', async (target, materialize) => {
    const downloadAsset = mock(async () => {
      throw new Error('A media-free article must not download an asset.');
    });
    const result = await materialize({
      recipe: {
        ...common(target, 'article'),
        title: 'A reviewed media-free article',
        markdown: '## Thesis\n\nThe article body is sufficient.',
      },
      expectedRevision: 3,
      now,
      exportedAt,
      downloadAsset,
    });

    expect(downloadAsset).not.toHaveBeenCalled();
    const zip = await unzip(result.bundleBytes);
    expect(await zip.file('article.md')?.async('string')).toContain('The article body is sufficient.');
    expect(zip.file('images/cover.jpg')).toBeNull();
    expect(Object.keys(zip.files).some((path) => /^images\/cover\./.test(path))).toBe(false);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest).toMatchObject({ platform: target, kind: 'article', images: [] });
    expect(manifest).not.toHaveProperty('cover');
  });

  it('keeps the first X article body image in the body when no cover was selected', async () => {
    const image = new Uint8Array(await sharp({
      create: { width: 320, height: 180, channels: 3, background: 'blue' },
    }).png().toBuffer());
    const asset = {
      id: 'asset_body',
      mimeType: 'image/png' as const,
      sizeBytes: image.byteLength,
      sha256: await sha256Hex(image),
    };
    const downloadAsset = mock(async () => image);
    const result = await materializeXPublicationBundle({
      recipe: {
        ...common('x', 'article'),
        title: 'Body image, no cover',
        markdown: '## Body\n\n![Chart](asset:asset_body)',
        orderedAssetIds: [asset.id],
        assets: [asset],
      },
      expectedRevision: 3,
      now,
      exportedAt,
      downloadAsset,
    });

    expect(downloadAsset).toHaveBeenCalledTimes(1);
    const zip = await unzip(result.bundleBytes);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest).not.toHaveProperty('cover');
    expect(manifest.images).toHaveLength(1);
    expect(manifest.images[0].path).not.toMatch(/^images\/cover\./);
    expect(zip.file(manifest.images[0].path)).not.toBeNull();
    expect(await zip.file('article.md')!.async('string')).toContain(`](${manifest.images[0].path})`);
  });

  it('rejects a repeated V3 Binance article asset reference before downloading it', async () => {
    const asset = {
      id: 'asset_body',
      mimeType: 'image/png' as const,
      sizeBytes: 8,
      sha256: 'a'.repeat(64),
    };
    const downloadAsset = mock(async () => new Uint8Array(8));

    await expect(materializePublicationBundle({
      recipe: {
        ...common('binance-square', 'article'),
        title: 'Exactly-once media',
        markdown: [
          '![First](asset:asset_body)',
          '![Repeated](asset:asset_body)',
        ].join('\n\n'),
        orderedAssetIds: [asset.id],
        assets: [asset],
      },
      expectedRevision: 3,
      now,
      exportedAt,
      downloadAsset,
    })).rejects.toThrow(/exactly once/i);
    expect(downloadAsset).not.toHaveBeenCalled();
  });

  it.each([
    ['reference-style image', '![Private][ref]\n\n[ref]: http://127.0.0.1/private.png'],
    ['raw HTML image', '<img src="http://127.0.0.1/private.png">'],
    ['Obsidian image', '![[../../private.png]]'],
    ['remote inline image', '![Remote](https://example.invalid/private.png)'],
    ['absolute local image', '![Local](/etc/private.png)'],
    ['traversing local image', '![Local](../../private.png)'],
    ['code-hidden image', '`![Hidden](../../private.png)`'],
    ['Mermaid image source', '```mermaid\ngraph TD; A-->B\n```'],
  ])('rejects an X Article containing a %s before asset download', async (_label, markdown) => {
    const downloadAsset = mock(async () => {
      throw new Error('Rejected Markdown must not download an asset.');
    });

    await expect(materializeXPublicationBundle({
      recipe: {
        ...common('x', 'article'),
        title: 'Strict reviewed media',
        markdown,
      },
      expectedRevision: 3,
      now,
      exportedAt,
      downloadAsset,
    })).rejects.toThrow(/image|media|markdown|mermaid/i);
    expect(downloadAsset).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', 'Body without the selected image.'],
    ['duplicate', '![One](asset:asset_body)\n\n![Two](asset:asset_body)'],
    ['extra', '![One](asset:asset_body)\n\n![Extra](https://example.invalid/extra.png)'],
  ])('rejects an X Article with %s reviewed body references before download', async (
    _label,
    markdown,
  ) => {
    const asset = {
      id: 'asset_body',
      mimeType: 'image/png' as const,
      sizeBytes: 8,
      sha256: 'a'.repeat(64),
    };
    const downloadAsset = mock(async () => new Uint8Array(8));

    await expect(materializeXPublicationBundle({
      recipe: {
        ...common('x', 'article'),
        title: 'Exactly-once media',
        markdown,
        orderedAssetIds: [asset.id],
        assets: [asset],
      },
      expectedRevision: 3,
      now,
      exportedAt,
      downloadAsset,
    })).rejects.toThrow(/exactly once|unbundled|unsafe|image/i);
    expect(downloadAsset).not.toHaveBeenCalled();
  });
});
