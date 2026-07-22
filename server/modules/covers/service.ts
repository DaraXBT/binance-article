import { z } from 'zod';

import { createArticleAssetReference } from '@/lib/article-assets';
import type { IllustrationStyleId } from '@/lib/config';
import { IllustrationStyleSchema, ImageGenerationStatusSchema } from '@/lib/schemas';
import { AppError } from '@/server/http/app-error';

const IdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/);
const MasterModeSchema = z.enum(['scene', 'mechanism', 'briefing', 'primer']);
const MimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);

export type BinanceMasterMode = z.infer<typeof MasterModeSchema>;

export interface ArticleCoverRecord {
  id: string;
  workspaceId: string;
  articleId: string;
  generationRevision: number;
  style: string;
  styleMode: string | null;
  prompt: string | null;
  status: z.infer<typeof ImageGenerationStatusSchema>;
  sourceAssetId: string | null;
  sourceMimeType: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ArticleCoverRepository {
  initialize(input: {
    id: string;
    workspaceId: string;
    articleId: string;
    generationRevision: number;
    style: IllustrationStyleId;
    styleMode: BinanceMasterMode | null;
    prompt: string;
    now: Date;
  }): Promise<ArticleCoverRecord | null>;
  markGenerated(input: {
    workspaceId: string;
    articleId: string;
    generationRevision: number;
    sourceAssetId: string;
    now: Date;
  }): Promise<ArticleCoverRecord | null>;
  markFailed(input: {
    workspaceId: string;
    articleId: string;
    generationRevision: number;
    error: string;
    now: Date;
  }): Promise<ArticleCoverRecord | null>;
  findByArticle(input: {
    workspaceId: string;
    articleId: string;
  }): Promise<ArticleCoverRecord | null>;
}

function validateRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError('Article cover revision is invalid.');
  }
  return revision;
}

function sourceFilename(mimeType: z.infer<typeof MimeTypeSchema>): string {
  if (mimeType === 'image/jpeg') return 'cover-source.jpg';
  if (mimeType === 'image/webp') return 'cover-source.webp';
  return 'cover-source.png';
}

export function serializeArticleCover(record: ArticleCoverRecord | null) {
  if (!record) return null;
  const style = IllustrationStyleSchema.parse(record.style);
  const styleMode = record.styleMode === null ? null : MasterModeSchema.parse(record.styleMode);
  const status = ImageGenerationStatusSchema.parse(record.status);
  const sourceMimeType = record.sourceMimeType === null
    ? null
    : MimeTypeSchema.parse(record.sourceMimeType);
  const imageUrl = record.sourceAssetId && sourceMimeType
    ? createArticleAssetReference(record.sourceAssetId, sourceFilename(sourceMimeType))
    : null;
  return {
    id: IdentifierSchema.parse(record.id),
    generationRevision: validateRevision(record.generationRevision),
    style,
    styleMode,
    prompt: record.prompt,
    status,
    imageUrl,
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function initializeArticleCover(input: {
  repository: ArticleCoverRepository;
  workspaceId: string;
  articleId: string;
  generationRevision: number;
  style: IllustrationStyleId;
  styleMode: BinanceMasterMode | null;
  prompt: string;
  coverId?: string;
  now?: Date;
}) {
  const record = await input.repository.initialize({
    id: IdentifierSchema.parse(input.coverId ?? crypto.randomUUID()),
    workspaceId: IdentifierSchema.parse(input.workspaceId),
    articleId: IdentifierSchema.parse(input.articleId),
    generationRevision: validateRevision(input.generationRevision),
    style: IllustrationStyleSchema.parse(input.style),
    styleMode: input.style === 'binance-master'
      ? MasterModeSchema.parse(input.styleMode)
      : null,
    prompt: z.string().min(1).max(50_000).parse(input.prompt),
    now: input.now ?? new Date(),
  });
  return record ? serializeArticleCover(record) : null;
}

export async function markArticleCoverGenerated(input: {
  repository: ArticleCoverRepository;
  workspaceId: string;
  articleId: string;
  generationRevision: number;
  sourceAssetId: string;
  now?: Date;
}) {
  const record = await input.repository.markGenerated({
    workspaceId: IdentifierSchema.parse(input.workspaceId),
    articleId: IdentifierSchema.parse(input.articleId),
    generationRevision: validateRevision(input.generationRevision),
    sourceAssetId: IdentifierSchema.parse(input.sourceAssetId),
    now: input.now ?? new Date(),
  });
  return record ? serializeArticleCover(record) : null;
}

export async function markArticleCoverFailed(input: {
  repository: ArticleCoverRepository;
  workspaceId: string;
  articleId: string;
  generationRevision: number;
  error: string;
  now?: Date;
}) {
  const record = await input.repository.markFailed({
    workspaceId: IdentifierSchema.parse(input.workspaceId),
    articleId: IdentifierSchema.parse(input.articleId),
    generationRevision: validateRevision(input.generationRevision),
    error: z.string().min(1).max(2_000).parse(input.error),
    now: input.now ?? new Date(),
  });
  return record ? serializeArticleCover(record) : null;
}

export async function getArticleCover(input: {
  repository: ArticleCoverRepository;
  workspaceId: string;
  articleId: string;
}) {
  const record = await input.repository.findByArticle({
    workspaceId: IdentifierSchema.parse(input.workspaceId),
    articleId: IdentifierSchema.parse(input.articleId),
  });
  return serializeArticleCover(record);
}

export function requireGeneratedArticleCover(record: ArticleCoverRecord | null): string {
  if (!record || record.status !== 'generated' || !record.sourceAssetId) {
    throw new AppError({
      code: 'PUBLICATION_COVER_NOT_READY',
      message: 'Generate the dedicated article cover before preparing this publication.',
      status: 409,
    });
  }
  return record.sourceAssetId;
}
