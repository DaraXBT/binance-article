import JSZip from 'jszip';
import { z } from 'zod';

import { sniffImageMimeType } from '@/lib/binance-export';

export const X_POST_STANDARD_CHARACTERS = 280;
export const X_POST_MAX_CHARACTERS = X_POST_STANDARD_CHARACTERS;
export const X_POST_MAX_IMAGES = 4;
export const X_POST_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const X_POST_MAX_BUNDLE_BYTES = 50 * 1024 * 1024;
const X_POST_MAX_TEXT_BYTES = 100 * 1024;
const X_POST_MAX_MANIFEST_BYTES = 64 * 1024;

const SUPPORTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const SAFE_IMAGE_PATH = /^images\/[0-9]{2}-post\.(?:jpg|jpeg|png|webp)$/;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

const XPostBundleFileSchema = z.object({
  path: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(64),
  bytes: z.number().int().nonnegative().max(X_POST_MAX_BUNDLE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const XPostBundleImageSchema = XPostBundleFileSchema.extend({
  path: z.string().regex(SAFE_IMAGE_PATH, 'Bundle image path is unsafe'),
  mimeType: z.enum(SUPPORTED_IMAGE_MIME_TYPES),
  slideId: z.string().regex(SAFE_IDENTIFIER, 'Slide ID is invalid'),
  order: z.number().int().min(0).max(X_POST_MAX_IMAGES - 1),
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000),
  bytes: z.number().int().nonnegative().max(X_POST_MAX_IMAGE_BYTES),
});

export const XPostBundleManifestSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal('xarticle'),
  platform: z.literal('x'),
  kind: z.literal('post'),
  articleId: z.string().regex(SAFE_IDENTIFIER, 'Article ID is invalid'),
  exportedAt: z.string().datetime({ offset: true }),
  post: XPostBundleFileSchema.extend({
    path: z.literal('post.txt'),
    mimeType: z.literal('text/plain'),
    bytes: z.number().int().nonnegative().max(X_POST_MAX_TEXT_BYTES),
  }),
  images: z.array(XPostBundleImageSchema).max(X_POST_MAX_IMAGES),
}).superRefine((manifest, context) => {
  const paths = new Set<string>();
  const orders = new Set<number>();
  const slideIds = new Set<string>();
  for (const image of manifest.images) {
    if (image.path !== getXPostImagePath(image.order, image.mimeType)) {
      context.addIssue({ code: 'custom', path: ['images'], message: 'Image paths must match their order and MIME type' });
    }
    if (paths.has(image.path)) {
      context.addIssue({ code: 'custom', path: ['images'], message: 'Image paths must be unique' });
    }
    if (orders.has(image.order)) {
      context.addIssue({ code: 'custom', path: ['images'], message: 'Image orders must be unique' });
    }
    if (slideIds.has(image.slideId)) {
      context.addIssue({ code: 'custom', path: ['images'], message: 'Slide images must be unique' });
    }
    paths.add(image.path);
    orders.add(image.order);
    slideIds.add(image.slideId);
  }
});

export type XPostBundleManifest = z.infer<typeof XPostBundleManifestSchema>;
export type XPostImageMime = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];
export type XPostBinaryInput = Uint8Array | ArrayBuffer | Blob;

export type XPostBundleImageInput = {
  slideId: string;
  order: number;
  path: string;
  bytes: XPostBinaryInput;
  mimeType: XPostImageMime;
  width: number;
  height: number;
};

export type CreateXPostBundleInput = {
  articleId: string;
  exportedAt?: Date;
  text: string;
  images: readonly XPostBundleImageInput[];
};

export type CreatedXPostBundle = {
  bytes: Uint8Array;
  manifest: XPostBundleManifest;
};

export type XPostExportIssues = {
  errors: string[];
  warnings: string[];
};

export type XPostValidationMessages = {
  contentRequired: string;
  maxImages: (max: number) => string;
  textTooLong: (max: number) => string;
};

function asBytes(input: XPostBinaryInput): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return Promise.resolve(input);
  if (input instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(input));
  return input.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

async function sha256(input: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function getXPostImagePath(order: number, mimeType: string): string {
  if (!Number.isInteger(order) || order < 0 || order >= X_POST_MAX_IMAGES) {
    throw new Error(`X post image order must be between 0 and ${X_POST_MAX_IMAGES - 1}.`);
  }
  const extension = mimeType === 'image/jpeg'
    ? 'jpg'
    : mimeType === 'image/png'
      ? 'png'
      : mimeType === 'image/webp'
        ? 'webp'
        : null;
  if (!extension) throw new Error(`Unsupported image MIME type: ${mimeType}`);
  return `images/${String(order + 1).padStart(2, '0')}-post.${extension}`;
}

const DEFAULT_VALIDATION_MESSAGES: XPostValidationMessages = {
  contentRequired: 'Add post text or select at least one image.',
  maxImages: (max) => `X posts support at most ${max} images.`,
  textTooLong: (max) => `X post text must be ${max.toLocaleString()} characters or fewer.`,
};

export function getXPostExportIssues(
  input: {
    text: string;
    selectedImageCount: number;
  },
  messages: XPostValidationMessages = DEFAULT_VALIDATION_MESSAGES,
): XPostExportIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = input.text.trim();

  if (!text && input.selectedImageCount === 0) {
    errors.push(messages.contentRequired);
  }
  if (input.selectedImageCount > X_POST_MAX_IMAGES) {
    errors.push(messages.maxImages(X_POST_MAX_IMAGES));
  }
  if ([...text].length > X_POST_MAX_CHARACTERS) {
    errors.push(messages.textTooLong(X_POST_MAX_CHARACTERS));
  }

  return { errors, warnings };
}

export async function createXPostBundle(
  input: CreateXPostBundleInput,
): Promise<CreatedXPostBundle> {
  const text = input.text.trim();
  const characterCount = [...text].length;
  if (!text && input.images.length === 0) {
    throw new Error('Add post text or select at least one image.');
  }
  if (characterCount > X_POST_MAX_CHARACTERS) {
    throw new Error(`X post text must be ${X_POST_MAX_CHARACTERS.toLocaleString()} characters or fewer.`);
  }
  if (input.images.length > X_POST_MAX_IMAGES) {
    throw new Error(`A maximum of ${X_POST_MAX_IMAGES} images is supported.`);
  }

  const textBytes = new TextEncoder().encode(text);
  if (textBytes.byteLength > X_POST_MAX_TEXT_BYTES) {
    throw new Error('X post text exceeds the bundle size limit.');
  }

  const seenPaths = new Set<string>();
  const seenOrders = new Set<number>();
  const seenSlides = new Set<string>();
  const imageFiles: Array<XPostBundleManifest['images'][number] & { bytesValue: Uint8Array }> = [];
  for (const image of [...input.images].sort((left, right) => left.order - right.order)) {
    if (!SAFE_IMAGE_PATH.test(image.path)) throw new Error(`Unsafe image path: ${image.path}`);
    if (seenPaths.has(image.path)) throw new Error(`Duplicate image path: ${image.path}`);
    if (seenOrders.has(image.order)) throw new Error(`Duplicate image order: ${image.order}`);
    if (seenSlides.has(image.slideId)) throw new Error(`Duplicate slide image: ${image.slideId}`);
    if (image.path !== getXPostImagePath(image.order, image.mimeType)) {
      throw new Error(`Image path does not match its order and MIME type: ${image.path}`);
    }
    seenPaths.add(image.path);
    seenOrders.add(image.order);
    seenSlides.add(image.slideId);

    const bytes = await asBytes(image.bytes);
    if (bytes.byteLength > X_POST_MAX_IMAGE_BYTES) {
      throw new Error(`${image.path} exceeds the 10 MiB image limit.`);
    }
    const actualMime = sniffImageMimeType(bytes);
    if (actualMime !== image.mimeType) throw new Error(`Image MIME mismatch for ${image.path}.`);
    imageFiles.push({
      ...image,
      bytes: bytes.byteLength,
      sha256: await sha256(bytes),
      bytesValue: bytes,
    });
  }

  const manifest = XPostBundleManifestSchema.parse({
    schemaVersion: 1,
    source: 'xarticle',
    platform: 'x',
    kind: 'post',
    articleId: input.articleId,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    post: {
      path: 'post.txt',
      mimeType: 'text/plain',
      bytes: textBytes.byteLength,
      sha256: await sha256(textBytes),
    },
    images: imageFiles.map(({ bytesValue: _bytesValue, ...image }) => image),
  });
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  if (manifestBytes.byteLength > X_POST_MAX_MANIFEST_BYTES) {
    throw new Error('X post manifest exceeds the bundle size limit.');
  }
  const totalBytes = textBytes.byteLength + manifestBytes.byteLength +
    imageFiles.reduce((sum, image) => sum + image.bytesValue.byteLength, 0);
  if (totalBytes > X_POST_MAX_BUNDLE_BYTES) {
    throw new Error('X post bundle exceeds the 50 MiB extracted size limit.');
  }

  const zip = new JSZip();
  zip.file('post.txt', textBytes);
  zip.file('manifest.json', manifestBytes);
  for (const image of imageFiles) zip.file(image.path, image.bytesValue);
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  if (bytes.byteLength > X_POST_MAX_BUNDLE_BYTES) {
    throw new Error('X post bundle exceeds the 50 MiB compressed size limit.');
  }

  return { bytes, manifest };
}
