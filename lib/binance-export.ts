import JSZip from 'jszip';
import { z } from 'zod';

import { getMarkdownImageReferenceErrors } from '../.agents/skills/baoyu-post-to-binance-square/scripts/markdown-image-references';

export const BINANCE_ARTICLE_MAX_CHARACTERS = 100_000;
export const BINANCE_TITLE_MAX_CHARACTERS = 200;
export const BINANCE_MAX_IMAGES = 20;
export const BINANCE_COVER_WIDTH = 1_000;
export const BINANCE_COVER_HEIGHT = 400;
export const BINANCE_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const BINANCE_MAX_BUNDLE_BYTES = 100 * 1024 * 1024;
const BINANCE_MAX_MANIFEST_BYTES = 256 * 1024;

const SUPPORTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const SAFE_BUNDLE_PATH = /^(?:article\.md|images\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpg|jpeg|png|webp))$/;

export const BinanceBundleFileSchema = z.object({
  path: z.string().regex(SAFE_BUNDLE_PATH, 'Bundle path is unsafe'),
  mimeType: z.enum(SUPPORTED_IMAGE_MIME_TYPES).or(z.literal('text/markdown')),
  bytes: z.number().int().nonnegative().max(BINANCE_MAX_BUNDLE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const BinanceBundleImageSchema = BinanceBundleFileSchema.extend({
  path: z.string().regex(/^images\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpg|jpeg|png|webp)$/),
  slideId: z.string().min(1),
  order: z.number().int().min(0).max(BINANCE_MAX_IMAGES - 1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().nonnegative().max(BINANCE_MAX_IMAGE_BYTES),
});

export const BinanceBundleManifestSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal('xarticle'),
  articleId: z.string().min(1).max(200),
  exportedAt: z.string().datetime({ offset: true }),
  title: z.string().trim().min(1).max(BINANCE_TITLE_MAX_CHARACTERS),
  markdown: BinanceBundleFileSchema.extend({
    path: z.literal('article.md'),
    mimeType: z.literal('text/markdown'),
    bytes: z.number().int().nonnegative().max(BINANCE_ARTICLE_MAX_CHARACTERS * 4),
  }),
  cover: BinanceBundleImageSchema.extend({
    path: z.literal('images/cover.jpg'),
    sourceSlideId: z.string().min(1),
    width: z.literal(BINANCE_COVER_WIDTH),
    height: z.literal(BINANCE_COVER_HEIGHT),
    mimeType: z.literal('image/jpeg'),
  }).omit({ slideId: true, order: true }),
  images: z.array(BinanceBundleImageSchema).max(BINANCE_MAX_IMAGES),
}).superRefine((manifest, ctx) => {
  const orders = new Set<number>();
  const paths = new Set<string>();
  for (const image of manifest.images) {
    if (orders.has(image.order)) {
      ctx.addIssue({ code: 'custom', path: ['images'], message: 'Image orders must be unique' });
    }
    if (paths.has(image.path) || image.path === manifest.cover.path) {
      ctx.addIssue({ code: 'custom', path: ['images'], message: 'Image paths must be unique' });
    }
    orders.add(image.order);
    paths.add(image.path);
  }
});

export type BinanceBundleManifest = z.infer<typeof BinanceBundleManifestSchema>;

export type BinanceExportSlide = {
  id: string;
  title: string;
  subtitle?: string | null;
  bullets?: string[] | null;
  notes?: string | null;
  imagePath?: string | null;
};

export type BinanceExportInput = {
  intro?: string | null;
  sections?: readonly string[] | null;
  tags?: readonly string[] | null;
  slides: readonly BinanceExportSlide[];
};

export type BinanceArticleMessages = {
  slideNoImage: (index: number) => string;
  slideUsesCopy: (index: number) => string;
  slideNoCopy: (index: number) => string;
};

export type BinanceValidationMessages = {
  titleRequired: string;
  titleTooLong: (max: number) => string;
  markdownRequired: string;
  markdownTooLong: string;
  coverRequired: string;
  slideNoImage: (index: number) => string;
  markdownImagesInvalid?: string;
};

export type BinanceExportIssues = {
  errors: string[];
  warnings: string[];
};

export type BinanceExportValidationInput = {
  title: string;
  markdown: string;
  /** True when the dedicated article cover is generated. The dedicated cover
   * is its own record, never a slide, so it cannot be validated by slide
   * lookup. */
  hasDedicatedCover?: boolean;
  /** Legacy cover-as-slide reference; only consulted when hasDedicatedCover
   * is not provided. */
  coverSlideId?: string | null;
  slides: readonly {
    id: string;
    imageUrl?: string | null;
    imageStatus?: string | null;
    imagePath?: string | null;
  }[];
};

export type BinaryInput = Uint8Array | ArrayBuffer | Blob;

export type BinanceBundleImageInput = {
  slideId: string;
  order: number;
  path: string;
  bytes: BinaryInput;
  mimeType: (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];
  width: number;
  height: number;
};

export type CreateBinanceBundleInput = {
  articleId: string;
  exportedAt?: Date;
  title: string;
  markdown: string;
  cover: {
    sourceSlideId: string;
    bytes: BinaryInput;
    mimeType: 'image/jpeg';
    width: number;
    height: number;
  };
  images: readonly BinanceBundleImageInput[];
};

export type CreatedBinanceBundle = {
  bytes: Uint8Array;
  manifest: BinanceBundleManifest;
};

function cleanHeading(value: string): string {
  return value.replace(/^#+\s*/, '').replace(/[\r\n]+/g, ' ').trim() || 'Untitled section';
}

function cleanImageAlt(value: string): string {
  return cleanHeading(value).replace(/[\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

function fallbackSlideBody(slide: BinanceExportSlide): string {
  const lines: string[] = [];
  if (slide.subtitle?.trim()) lines.push(slide.subtitle.trim());
  for (const bullet of slide.bullets ?? []) {
    if (bullet.trim()) lines.push(`- ${bullet.trim()}`);
  }
  return lines.join('\n');
}

export function normalizeBinanceTags(tags: readonly string[] | null | undefined): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawTag of tags ?? []) {
    const tag = rawTag
      .trim()
      .replace(/^[#$]+/u, '')
      .replace(/[\s-]+/gu, '_')
      .replace(/[^\p{L}\p{N}_]/gu, '')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }

  return result;
}

export function getSlideImagePath(order: number, mimeType: string): string {
  if (!Number.isInteger(order) || order < 0 || order >= BINANCE_MAX_IMAGES) {
    throw new Error(`Slide order must be between 0 and ${BINANCE_MAX_IMAGES - 1}`);
  }
  const extension = mimeType === 'image/jpeg'
    ? 'jpg'
    : mimeType === 'image/png'
      ? 'png'
      : mimeType === 'image/webp'
        ? 'webp'
        : null;
  if (!extension) throw new Error(`Unsupported image MIME type: ${mimeType}`);
  return `images/${String(order + 1).padStart(2, '0')}-slide.${extension}`;
}

const DEFAULT_ARTICLE_MESSAGES: BinanceArticleMessages = {
  slideNoImage: (index) => `Slide ${index} has no generated image and will be exported as text only.`,
  slideUsesCopy: (index) => `Slide ${index} uses slide content because its blog section is missing.`,
  slideNoCopy: (index) => `Slide ${index} has no blog section or slide copy.`,
};

export function assembleBinanceArticle(
  input: BinanceExportInput,
  messages: BinanceArticleMessages = DEFAULT_ARTICLE_MESSAGES,
): {
  markdown: string;
  warnings: string[];
} {
  const blocks: string[] = [];
  const warnings: string[] = [];
  const sections = input.sections ?? [];

  if (input.intro?.trim()) blocks.push(input.intro.trim());

  input.slides.forEach((slide, index) => {
    const section = sections[index]?.trim();
    const fallback = fallbackSlideBody(slide);
    const body = section || fallback;
    const block: string[] = [`## ${cleanHeading(slide.title)}`];

    if (section) {
      block.push(section);
    } else if (fallback) {
      block.push(fallback);
      warnings.push(messages.slideUsesCopy(index + 1));
    } else {
      warnings.push(messages.slideNoCopy(index + 1));
    }

    if (slide.imagePath) {
      block.push(`![${cleanImageAlt(slide.title)}](${slide.imagePath})`);
    } else {
      warnings.push(messages.slideNoImage(index + 1));
    }

    if (body || slide.imagePath) blocks.push(block.join('\n\n'));
  });

  const normalizedTags = normalizeBinanceTags(input.tags);
  if (normalizedTags.length > 0) blocks.push(normalizedTags.map((tag) => `#${tag}`).join(' '));

  return { markdown: `${blocks.join('\n\n').trim()}\n`, warnings };
}

export function calculateCoverCrop(
  width: number,
  height: number,
  focalX = 0.5,
  focalY = 0.5,
  targetRatio = 2.5,
): { sourceX: number; sourceY: number; sourceWidth: number; sourceHeight: number } {
  if (![width, height, focalX, focalY, targetRatio].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('Image dimensions must be positive finite numbers');
  }
  const clampedX = Math.min(1, Math.max(0, focalX));
  const clampedY = Math.min(1, Math.max(0, focalY));
  let sourceWidth = width;
  let sourceHeight = Math.floor(width / targetRatio);
  if (sourceHeight > height) {
    sourceHeight = height;
    sourceWidth = Math.floor(height * targetRatio);
  }
  sourceWidth = Math.max(1, sourceWidth);
  sourceHeight = Math.max(1, sourceHeight);
  const sourceX = Math.round((width - sourceWidth) * clampedX);
  const sourceY = Math.round((height - sourceHeight) * clampedY);
  return {
    sourceX: Math.min(Math.max(0, sourceX), width - sourceWidth),
    sourceY: Math.min(Math.max(0, sourceY), height - sourceHeight),
    sourceWidth,
    sourceHeight,
  };
}

function asBytes(input: BinaryInput): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return Promise.resolve(input);
  if (input instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(input));
  return input.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

export function sniffImageMimeType(input: Uint8Array | ArrayBuffer): (typeof SUPPORTED_IMAGE_MIME_TYPES)[number] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const isPng = bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    .every((value, index) => bytes[index] === value);
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (isPng) return 'image/png';
  if (isJpeg) return 'image/jpeg';
  if (isWebp) return 'image/webp';
  throw new Error('Image signature is not a supported PNG, JPEG, or WebP file');
}

async function sha256(input: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const DEFAULT_VALIDATION_MESSAGES: BinanceValidationMessages = {
  titleRequired: 'A Binance article title is required.',
  titleTooLong: (max) => `The Binance article title must be ${max} characters or fewer.`,
  markdownRequired: 'Article Markdown cannot be empty.',
  markdownTooLong: 'Article Markdown exceeds Binance\'s 100,000-character limit.',
  coverRequired: 'Generate the dedicated 5:2 article cover before preparing Binance.',
  slideNoImage: DEFAULT_ARTICLE_MESSAGES.slideNoImage,
};

export function getBinanceExportIssues(
  input: BinanceExportValidationInput,
  messages: BinanceValidationMessages = DEFAULT_VALIDATION_MESSAGES,
): BinanceExportIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  const title = input.title.trim();
  const markdown = input.markdown.trim();

  if (!title) errors.push(messages.titleRequired);
  if (title.length > BINANCE_TITLE_MAX_CHARACTERS) {
    errors.push(messages.titleTooLong(BINANCE_TITLE_MAX_CHARACTERS));
  }
  if (!markdown) errors.push(messages.markdownRequired);
  if (markdown.length > BINANCE_ARTICLE_MAX_CHARACTERS) {
    errors.push(messages.markdownTooLong);
  }

  const coverReady = input.hasDedicatedCover !== undefined
    ? input.hasDedicatedCover
    : (() => {
      const cover = input.slides.find((slide) => slide.id === input.coverSlideId);
      return Boolean(cover?.imageUrl && cover.imageStatus === 'generated');
    })();
  if (!coverReady) {
    errors.push(messages.coverRequired);
  }
  const expectedImagePaths: string[] = [];
  for (const [index, slide] of input.slides.entries()) {
    if (!slide.imageUrl || slide.imageStatus !== 'generated') {
      warnings.push(messages.slideNoImage(index + 1));
    } else if (slide.imagePath) {
      expectedImagePaths.push(slide.imagePath);
    }
  }
  const markdownImageErrors = getMarkdownImageReferenceErrors(
    markdown,
    expectedImagePaths,
    'Article Markdown',
  );
  if (markdownImageErrors.length > 0 && messages.markdownImagesInvalid) {
    errors.push(messages.markdownImagesInvalid);
  } else {
    errors.push(...markdownImageErrors);
  }
  return { errors, warnings };
}

export async function createBinanceBundle(input: CreateBinanceBundleInput): Promise<CreatedBinanceBundle> {
  const title = input.title.trim();
  const markdownBytes = new TextEncoder().encode(input.markdown);
  if (!title) throw new Error('A Binance article title is required.');
  if (title.length > BINANCE_TITLE_MAX_CHARACTERS) throw new Error('Binance article title is too long.');
  if (!input.markdown.trim()) throw new Error('Article Markdown cannot be empty.');
  if ([...input.markdown].length > BINANCE_ARTICLE_MAX_CHARACTERS) {
    throw new Error('Article Markdown exceeds Binance\'s 100,000-character limit.');
  }
  if (markdownBytes.byteLength > BINANCE_ARTICLE_MAX_CHARACTERS * 4) {
    throw new Error('Article Markdown exceeds the export size limit.');
  }
  if (input.cover.width !== BINANCE_COVER_WIDTH || input.cover.height !== BINANCE_COVER_HEIGHT) {
    throw new Error('Cover image must be exactly 1000x400 (5:2).');
  }
  if (input.images.length > BINANCE_MAX_IMAGES) throw new Error(`A maximum of ${BINANCE_MAX_IMAGES} images is supported.`);

  const coverBytes = await asBytes(input.cover.bytes);
  if (coverBytes.byteLength > BINANCE_MAX_IMAGE_BYTES) throw new Error('Cover image exceeds the 10 MiB limit.');
  if (sniffImageMimeType(coverBytes) !== 'image/jpeg') throw new Error('Cover image is not a valid JPEG.');
  const imageFiles = [] as Array<BinanceBundleManifest['images'][number] & { bytesValue: Uint8Array }>;
  const seenPaths = new Set<string>();
  for (const image of [...input.images].sort((a, b) => a.order - b.order)) {
    if (!SAFE_BUNDLE_PATH.test(image.path) || image.path === 'images/cover.jpg') {
      throw new Error(`Unsafe image path: ${image.path}`);
    }
    if (seenPaths.has(image.path)) throw new Error(`Duplicate image path: ${image.path}`);
    seenPaths.add(image.path);
    const bytes = await asBytes(image.bytes);
    if (bytes.byteLength > BINANCE_MAX_IMAGE_BYTES) throw new Error(`${image.path} exceeds the 10 MiB image limit.`);
    const actualMime = sniffImageMimeType(bytes);
    if (actualMime !== image.mimeType) throw new Error(`Image MIME mismatch for ${image.path}.`);
    imageFiles.push({ ...image, bytes: bytes.byteLength, sha256: await sha256(bytes), bytesValue: bytes });
  }
  const markdownImageErrors = getMarkdownImageReferenceErrors(
    input.markdown,
    imageFiles.map((image) => image.path),
    'Article Markdown',
  );
  if (markdownImageErrors[0]) throw new Error(markdownImageErrors[0]);

  const manifestWithoutHashes = {
    schemaVersion: 1 as const,
    source: 'xarticle' as const,
    articleId: input.articleId,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    title,
    markdown: {
      path: 'article.md' as const,
      mimeType: 'text/markdown' as const,
      bytes: markdownBytes.byteLength,
      sha256: await sha256(markdownBytes),
    },
    cover: {
      path: 'images/cover.jpg' as const,
      sourceSlideId: input.cover.sourceSlideId,
      mimeType: 'image/jpeg' as const,
      bytes: coverBytes.byteLength,
      sha256: await sha256(coverBytes),
      width: input.cover.width as 1000,
      height: input.cover.height as 400,
    },
    images: imageFiles.map(({ bytesValue: _bytesValue, ...image }) => image),
  };
  const manifest = BinanceBundleManifestSchema.parse(manifestWithoutHashes);
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  if (manifestBytes.byteLength > BINANCE_MAX_MANIFEST_BYTES) throw new Error('Bundle manifest exceeds the export size limit.');
  const extractedBytes = markdownBytes.byteLength + coverBytes.byteLength + manifestBytes.byteLength +
    imageFiles.reduce((total, image) => total + image.bytesValue.byteLength, 0);
  if (extractedBytes > BINANCE_MAX_BUNDLE_BYTES) throw new Error('Bundle exceeds the 100 MiB extracted size limit.');
  const zip = new JSZip();
  zip.file('article.md', markdownBytes);
  zip.file('manifest.json', manifestBytes);
  zip.file('images/cover.jpg', coverBytes);
  for (const image of imageFiles) zip.file(image.path, image.bytesValue);
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  if (bytes.byteLength > BINANCE_MAX_BUNDLE_BYTES) throw new Error('Bundle exceeds the 100 MiB compressed size limit.');
  return { bytes, manifest };
}
