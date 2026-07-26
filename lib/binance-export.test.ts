import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  BINANCE_ARTICLE_MAX_CHARACTERS,
  BinanceBundleManifestSchema,
  assembleBinanceArticle,
  calculateCoverCrop,
  createBinanceBundle,
  getBinanceExportIssues,
  getSlideImagePath,
  normalizeBinanceTags,
  sniffImageMimeType,
} from './binance-export';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

describe('normalizeBinanceTags', () => {
  it('normalizes, de-duplicates, and preserves international tags', () => {
    expect(
      normalizeBinanceTags([' #BTC ', 'web 3', '#btc', 'Café!', '$ETH', '比特币'])
    ).toEqual(['BTC', 'web_3', 'Café', 'ETH', '比特币']);
  });
});

describe('getSlideImagePath', () => {
  it('uses deterministic ordered filenames for supported image types', () => {
    expect(getSlideImagePath(0, 'image/png')).toBe('images/01-slide.png');
    expect(getSlideImagePath(9, 'image/jpeg')).toBe('images/10-slide.jpg');
    expect(getSlideImagePath(1, 'image/webp')).toBe('images/02-slide.webp');
  });

  it('rejects unsupported image types', () => {
    expect(() => getSlideImagePath(0, 'image/gif')).toThrow(/unsupported/i);
  });
});

describe('assembleBinanceArticle', () => {
  it('maps blog sections to ordered slides and appends normalized tags', () => {
    const result = assembleBinanceArticle({
      intro: 'A concise introduction.',
      sections: ['First section copy.'],
      tags: ['#BTC', 'web 3'],
      slides: [
        {
          id: 'slide-1',
          title: 'Market setup',
          subtitle: null,
          bullets: [],
          notes: null,
          imagePath: 'images/01-slide.png',
        },
        {
          id: 'slide-2',
          title: 'Risk controls',
          subtitle: 'Protect the downside.',
          bullets: ['Size positions', 'Use invalidation levels'],
          notes: null,
          imagePath: 'images/02-slide.png',
        },
      ],
    });

    expect(result.markdown).toContain('A concise introduction.');
    expect(result.markdown).toContain('## Market setup');
    expect(result.markdown).toContain('![Market setup](images/01-slide.png)');
    expect(result.markdown).toContain('First section copy.');
    expect(result.markdown).toContain('## Risk controls');
    expect(result.markdown).toContain('Protect the downside.');
    expect(result.markdown).toContain('- Size positions');
    expect(result.markdown).toMatch(/#BTC #web_3\s*$/);
    expect(result.warnings).toContain('Slide 2 uses slide content because its blog section is missing.');
  });

  it('normalizes bracketed slide titles into publisher-safe image alt text', () => {
    const result = assembleBinanceArticle({
      slides: [{ id: 'slide-1', title: 'BTC [Spot] setup', imagePath: 'images/01-slide.png' }],
    });
    expect(result.markdown).toContain('![BTC Spot setup](images/01-slide.png)');
  });

  it('warns about missing optional images without emitting broken Markdown', () => {
    const result = assembleBinanceArticle({
      intro: '',
      sections: ['Body'],
      tags: [],
      slides: [{
        id: 'slide-1',
        title: 'No image',
        subtitle: null,
        bullets: [],
        notes: null,
        imagePath: null,
      }],
    });

    expect(result.markdown).not.toContain('![');
    expect(result.warnings).toContain('Slide 1 has no generated image and will be exported as text only.');
  });
});

describe('calculateCoverCrop', () => {
  it('calculates a clamped 5:2 crop for landscape images', () => {
    expect(calculateCoverCrop(1600, 900, 0.5, 0.5)).toEqual({
      sourceX: 0,
      sourceY: 130,
      sourceWidth: 1600,
      sourceHeight: 640,
    });
  });

  it('moves the crop using a normalized focal point without leaving the image', () => {
    expect(calculateCoverCrop(800, 1200, 0.5, 1)).toEqual({
      sourceX: 0,
      sourceY: 880,
      sourceWidth: 800,
      sourceHeight: 320,
    });
  });
});

describe('sniffImageMimeType', () => {
  it('recognizes PNG, JPEG, and WebP signatures', () => {
    expect(sniffImageMimeType(PNG_BYTES)).toBe('image/png');
    expect(sniffImageMimeType(JPEG_BYTES)).toBe('image/jpeg');
    expect(sniffImageMimeType(new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]))).toBe('image/webp');
  });

  it('rejects unknown signatures', () => {
    expect(() => sniffImageMimeType(new Uint8Array([1, 2, 3]))).toThrow(/signature/i);
  });
});

describe('getBinanceExportIssues', () => {
  it('distinguishes blocking errors from warnings', () => {
    const issues = getBinanceExportIssues({
      title: ' ',
      markdown: 'x'.repeat(BINANCE_ARTICLE_MAX_CHARACTERS + 1),
      coverSlideId: null,
      slides: [],
    });

    expect(issues.errors).toEqual(expect.arrayContaining([
      'A Binance article title is required.',
      'Generate the dedicated 5:2 article cover before preparing Binance.',
    ]));
    expect(issues.errors.some((message) => message.includes('100,000'))).toBe(true);
  });

  it('accepts the dedicated cover without requiring a matching slide id', () => {
    // Regression: the dedicated cover is its own record; validating it by
    // slide lookup blocked every real Binance prepare.
    const issues = getBinanceExportIssues({
      title: 'Valid title',
      markdown: 'A complete body.\n\n![Slide](images/01-slide.png)',
      hasDedicatedCover: true,
      slides: [{
        id: 'slide-1',
        imageUrl: 'https://example.com/slide.png',
        imageStatus: 'generated',
        imagePath: 'images/01-slide.png',
      }],
    });

    expect(issues.errors).toEqual([]);
  });

  it('still requires the cover when the dedicated flag says it is missing', () => {
    const issues = getBinanceExportIssues({
      title: 'Valid title',
      markdown: 'A complete body.',
      hasDedicatedCover: false,
      slides: [{
        id: 'slide-1',
        imageUrl: 'https://example.com/slide.png',
        imageStatus: 'generated',
        imagePath: 'images/01-slide.png',
      }],
    });

    expect(issues.errors).toContain(
      'Generate the dedicated 5:2 article cover before preparing Binance.',
    );
  });

  it('blocks export if edited Markdown drops a bundled image reference', () => {
    const issues = getBinanceExportIssues({
      title: 'Valid title',
      markdown: 'Body without the image.',
      coverSlideId: 'slide-1',
      slides: [{
        id: 'slide-1',
        imageUrl: 'https://example.com/slide.png',
        imageStatus: 'generated',
        imagePath: 'images/01-slide.png',
      }],
    });
    expect(issues.errors).toContain(
      'Article Markdown must reference the bundled image images/01-slide.png exactly once.'
    );
  });

  it('accepts generated Markdown whose image destinations exactly match the export set', () => {
    const issues = getBinanceExportIssues({
      title: 'Valid title',
      markdown: '## Slide\n\n![Slide](images/01-slide.png)',
      coverSlideId: 'slide-1',
      slides: [{
        id: 'slide-1',
        imageUrl: 'https://example.com/slide.png',
        imageStatus: 'generated',
        imagePath: 'images/01-slide.png',
      }],
    });
    expect(issues.errors).toEqual([]);
  });

  it.each([
    {
      name: 'a listed path hidden in image alt text with a remote destination',
      markdown: '![images/01-slide.png](https://example.invalid/private.png)',
      error: /unbundled or unsafe.*https:/i,
    },
    {
      name: 'a listed path hidden in code',
      markdown: '`images/01-slide.png`',
      error: /must reference the bundled image/i,
    },
    {
      name: 'an extra remote image destination',
      markdown: '![Slide](images/01-slide.png)\n\n![Remote](https://example.invalid/remote.png)',
      error: /unbundled or unsafe.*https:/i,
    },
    {
      name: 'an extra absolute image destination',
      markdown: '![Slide](images/01-slide.png)\n\n![Secret](/Users/alice/secret.png)',
      error: /unbundled or unsafe.*\/Users\/alice/i,
    },
    {
      name: 'a raw HTML image source',
      markdown: '![Slide](images/01-slide.png)\n\n<img src="https://example.invalid/raw.png">',
      error: /raw HTML image/i,
    },
    {
      name: 'a resource-loading raw HTML tag',
      markdown: '![Slide](images/01-slide.png)\n\n<iframe src="http://127.0.0.1/private"></iframe>',
      error: /unsupported raw HTML/i,
    },
    {
      name: 'a Mermaid block that would generate an unmanifested image',
      markdown: '![Slide](images/01-slide.png)\n\n```mermaid\ngraph TD\nA --> B\n```',
      error: /cannot contain Mermaid blocks/i,
    },
  ])('rejects $name', ({ markdown, error }) => {
    const issues = getBinanceExportIssues({
      title: 'Valid title',
      markdown,
      coverSlideId: 'slide-1',
      slides: [{
        id: 'slide-1',
        imageUrl: 'https://example.com/slide.png',
        imageStatus: 'generated',
        imagePath: 'images/01-slide.png',
      }],
    });
    expect(issues.errors.some((message) => error.test(message))).toBe(true);
  });
});

describe('createBinanceBundle', () => {
  it('creates a schema-valid ZIP whose manifest hashes match every file', async () => {
    const { bytes, manifest } = await createBinanceBundle({
      articleId: 'article-123',
      exportedAt: new Date('2026-07-18T00:00:00.000Z'),
      title: 'Safe Binance export',
      markdown: 'Intro\n\n## Slide\n\n![Slide](images/01-slide.png)',
      cover: {
        sourceSlideId: 'slide-1',
        bytes: JPEG_BYTES,
        mimeType: 'image/jpeg',
        width: 1000,
        height: 400,
      },
      images: [{
        slideId: 'slide-1',
        order: 0,
        path: 'images/01-slide.png',
        bytes: PNG_BYTES,
        mimeType: 'image/png',
        width: 1600,
        height: 900,
      }],
    });

    expect(BinanceBundleManifestSchema.parse(manifest)).toEqual(manifest);
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file('article.md')?.async('string')).toBe(
      'Intro\n\n## Slide\n\n![Slide](images/01-slide.png)'
    );
    const parsedManifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(parsedManifest).toEqual(manifest);
    expect(await zip.file('images/cover.jpg')?.async('uint8array')).toEqual(JPEG_BYTES);
    expect(await zip.file('images/01-slide.png')?.async('uint8array')).toEqual(PNG_BYTES);
    expect(manifest.markdown.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.cover.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.images[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a direct bundle request whose Markdown points at an unbundled image', async () => {
    await expect(createBinanceBundle({
      articleId: 'article-123',
      title: 'Unsafe Binance export',
      markdown: '![images/01-slide.png](/Users/alice/secret.png)',
      cover: {
        sourceSlideId: 'slide-1',
        bytes: JPEG_BYTES,
        mimeType: 'image/jpeg',
        width: 1000,
        height: 400,
      },
      images: [{
        slideId: 'slide-1',
        order: 0,
        path: 'images/01-slide.png',
        bytes: PNG_BYTES,
        mimeType: 'image/png',
        width: 1600,
        height: 900,
      }],
    })).rejects.toThrow(/inside code|unbundled or unsafe/i);
  });

  it('enforces Binance character limits for direct bundle creation', async () => {
    await expect(createBinanceBundle({
      articleId: 'article-123',
      title: 'Oversized Binance export',
      markdown: 'a'.repeat(BINANCE_ARTICLE_MAX_CHARACTERS + 1),
      cover: {
        sourceSlideId: 'slide-1',
        bytes: JPEG_BYTES,
        mimeType: 'image/jpeg',
        width: 1000,
        height: 400,
      },
      images: [],
    })).rejects.toThrow(/100,000-character limit/i);
  });

  it('rejects body images above the publisher per-image limit', async () => {
    const oversizedImage = new Uint8Array((10 * 1024 * 1024) + 1);
    oversizedImage.set(PNG_BYTES);
    await expect(createBinanceBundle({
      articleId: 'article-123',
      title: 'Oversized image export',
      markdown: '![Slide](images/01-slide.png)',
      cover: {
        sourceSlideId: 'slide-1',
        bytes: JPEG_BYTES,
        mimeType: 'image/jpeg',
        width: 1000,
        height: 400,
      },
      images: [{
        slideId: 'slide-1',
        order: 0,
        path: 'images/01-slide.png',
        bytes: oversizedImage,
        mimeType: 'image/png',
        width: 1600,
        height: 900,
      }],
    })).rejects.toThrow(/10 MiB image limit/i);
  });
});
