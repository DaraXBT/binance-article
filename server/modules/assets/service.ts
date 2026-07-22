import { z } from 'zod';

import { createArticleAssetReference } from '@/lib/article-assets';
import { AppError } from '@/server/http/app-error';

const MAX_ARTICLE_ASSET_BYTES = 10 * 1024 * 1024;
const IdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/);
const FilenameSchema = z.string().min(1).max(200).refine((value) => (
  value === value.trim() && value !== '.' && value !== '..' && !/[\\/\u0000-\u001f\u007f]/.test(value)
), 'Invalid article asset filename.');
const MimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
const ArticleAssetPurposeSchema = z.enum(['slide_image', 'cover_image']);

export type ArticleAssetPurpose = z.infer<typeof ArticleAssetPurposeSchema>;

export interface ArticleAssetMetadata {
  r2Key: string;
  mimeType: z.infer<typeof MimeTypeSchema>;
  sizeBytes: number;
  sha256: string;
}

export interface ReplacedArticleAsset {
  assetId: string;
  retiredR2Keys: string[];
}

export interface ArticleAssetRepository {
  replaceAsset(input: {
    assetId: string;
    workspaceId: string;
    articleId: string;
    r2Key: string;
    assetKeyPrefix: string;
    purpose: ArticleAssetPurpose;
    mimeType: z.infer<typeof MimeTypeSchema>;
    sizeBytes: number;
    sha256: string;
    now: Date;
  }): Promise<ReplacedArticleAsset | null>;
  authorizeAsset(input: {
    assetId: string;
    workspaceId: string;
    articleId: string;
    purpose?: ArticleAssetPurpose;
  }): Promise<ArticleAssetMetadata | null>;
}

export interface ArticleAssetObject {
  body: BodyInit;
  size: number;
  etag?: string;
  httpMetadata?: { contentType?: string };
}

export interface ArticleAssetBucket {
  put(
    key: string,
    value: Uint8Array,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
    },
  ): Promise<{ size: number; etag?: string }>;
  get(key: string): Promise<ArticleAssetObject | null>;
  delete(key: string): Promise<void>;
}

function notFound(): AppError {
  return new AppError({
    code: 'ARTICLE_ASSET_NOT_FOUND',
    message: 'Article asset not found.',
    status: 404,
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function extensionFor(filename: string, mimeType: z.infer<typeof MimeTypeSchema>): string {
  const lower = filename.toLowerCase();
  const valid = mimeType === 'image/png'
    ? lower.endsWith('.png')
    : mimeType === 'image/webp'
      ? lower.endsWith('.webp')
      : lower.endsWith('.jpg') || lower.endsWith('.jpeg');
  if (!valid) throw new AppError({
    code: 'ARTICLE_ASSET_TYPE_MISMATCH',
    message: 'Article asset filename and media type do not match.',
    status: 400,
  });
  return lower.slice(lower.lastIndexOf('.'));
}

export async function storeArticleAsset(input: {
  repository: ArticleAssetRepository;
  bucket: ArticleAssetBucket;
  workspaceId: string;
  articleId: string;
  slideId?: string;
  purpose?: ArticleAssetPurpose;
  assetScope?: string;
  assetId?: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  now?: Date;
}) {
  const workspaceId = IdentifierSchema.parse(input.workspaceId);
  const articleId = IdentifierSchema.parse(input.articleId);
  const purpose = ArticleAssetPurposeSchema.parse(input.purpose ?? 'slide_image');
  const slideId = input.slideId === undefined ? undefined : IdentifierSchema.parse(input.slideId);
  const assetScope = input.assetScope === undefined
    ? undefined
    : IdentifierSchema.parse(input.assetScope);
  if (purpose === 'slide_image' && !slideId) {
    throw new AppError({
      code: 'ARTICLE_ASSET_SCOPE_INVALID',
      message: 'Slide assets require a slide identifier.',
      status: 400,
    });
  }
  const assetId = IdentifierSchema.parse(input.assetId ?? crypto.randomUUID());
  const filename = FilenameSchema.parse(input.filename);
  const mimeType = MimeTypeSchema.parse(input.mimeType);
  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_ARTICLE_ASSET_BYTES) {
    throw new AppError({
      code: 'ARTICLE_ASSET_SIZE_INVALID',
      message: 'Article asset size is invalid.',
      status: 400,
    });
  }
  const extension = extensionFor(filename, mimeType);
  const now = input.now ?? new Date();
  const sha256 = await sha256Hex(bytes);
  const assetKeyPrefix = purpose === 'slide_image'
    ? `workspaces/${workspaceId}/articles/${articleId}/slides/${slideId}/`
    : `workspaces/${workspaceId}/articles/${articleId}/covers/${assetScope ?? 'current'}/`;
  const r2Key = `${assetKeyPrefix}${assetId}${extension}`;
  const stored = await input.bucket.put(r2Key, bytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: { assetId, articleId, purpose, sha256 },
  });
  if (stored.size !== bytes.byteLength) {
    await input.bucket.delete(r2Key).catch(() => undefined);
    throw new AppError({
      code: 'ARTICLE_ASSET_INTEGRITY_FAILED',
      message: 'Article asset integrity verification failed.',
      status: 409,
    });
  }

  let recorded: ReplacedArticleAsset | null;
  try {
    recorded = await input.repository.replaceAsset({
      assetId,
      workspaceId,
      articleId,
      r2Key,
      assetKeyPrefix,
      purpose,
      mimeType,
      sizeBytes: bytes.byteLength,
      sha256,
      now,
    });
  } catch (error) {
    await input.bucket.delete(r2Key).catch(() => undefined);
    throw error;
  }
  if (!recorded) {
    await input.bucket.delete(r2Key).catch(() => undefined);
    throw notFound();
  }
  await Promise.allSettled(recorded.retiredR2Keys.map((key) => input.bucket.delete(key)));
  return {
    assetId: recorded.assetId,
    reference: createArticleAssetReference(recorded.assetId, filename),
    mimeType,
    sizeBytes: bytes.byteLength,
    sha256,
  };
}

export async function loadArticleAsset(input: {
  repository: ArticleAssetRepository;
  bucket: ArticleAssetBucket;
  workspaceId: string;
  articleId: string;
  assetId: string;
  purpose?: ArticleAssetPurpose;
}) {
  const metadata = await input.repository.authorizeAsset({
    workspaceId: IdentifierSchema.parse(input.workspaceId),
    articleId: IdentifierSchema.parse(input.articleId),
    assetId: IdentifierSchema.parse(input.assetId),
    purpose: input.purpose === undefined
      ? undefined
      : ArticleAssetPurposeSchema.parse(input.purpose),
  });
  if (!metadata) throw notFound();
  const object = await input.bucket.get(metadata.r2Key);
  if (!object) throw notFound();
  if (object.size !== metadata.sizeBytes) {
    throw new AppError({
      code: 'ARTICLE_ASSET_INTEGRITY_FAILED',
      message: 'Article asset integrity verification failed.',
      status: 409,
    });
  }
  return {
    body: object.body,
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes,
    sha256: metadata.sha256,
    ...(object.etag ? { etag: object.etag } : {}),
  };
}
