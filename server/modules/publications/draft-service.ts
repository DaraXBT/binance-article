import { z } from 'zod';

import {
  BINANCE_POST_MAX_CHARACTERS,
  BINANCE_POST_MAX_IMAGES,
  PUBLICATION_DRAFT_LIFETIME_MS,
  PublicationKindSchema,
  PublicationTargetSchema,
  X_POST_MAX_CHARACTERS,
  X_POST_MAX_IMAGES,
  type PublicationKind,
  type PublicationTarget,
} from '@/server/domain/publication-recipe';
import { AppError } from '@/server/http/errors';
import {
  getMarkdownImageReferenceErrors,
} from '../../../.agents/skills/baoyu-post-to-binance-square/scripts/markdown-image-references';

const IdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/);
const ExpectedRevisionSchema = z.number().int().nonnegative().safe();

function validateArticleBodyReferences(
  draft: { markdown: string; orderedAssetIds: string[] },
  context: z.RefinementCtx,
): void {
  const uniqueIds = new Set(draft.orderedAssetIds);
  if (uniqueIds.size !== draft.orderedAssetIds.length) {
    context.addIssue({ code: 'custom', path: ['orderedAssetIds'], message: 'Asset order contains duplicates.' });
  }
  const imageErrors = getMarkdownImageReferenceErrors(
    draft.markdown,
    draft.orderedAssetIds.map((id) => `asset:${id}`),
    'Article Markdown',
  );
  for (const message of imageErrors) {
    context.addIssue({ code: 'custom', path: ['markdown'], message });
  }
}

const ArticleCoverDraftSchema = z.object({
  assetId: IdentifierSchema,
  focalX: z.number().finite().min(0).max(1).default(0.5),
  focalY: z.number().finite().min(0).max(1).default(0.5),
  targetWidth: z.literal(1000).default(1000),
  targetHeight: z.literal(400).default(400),
}).strict();

export const ArticleDraftPayloadSchema = z.object({
  title: z.string().trim().min(1).max(200),
  markdown: z.string().max(100_000).refine(
    (value) => value.trim().length > 0,
    'Article Markdown must not be empty.',
  ),
  cover: ArticleCoverDraftSchema.optional(),
  orderedAssetIds: z.array(IdentifierSchema).max(10),
}).strict().superRefine(validateArticleBodyReferences);

function postDraftPayloadSchema(maximumCharacters: number, maximumImages: number, platform: string) {
  return z.object({
    text: z.string().trim().refine(
      (value) => [...value].length <= maximumCharacters,
      `${platform} post text must be ${maximumCharacters} characters or fewer.`,
    ),
    orderedAssetIds: z.array(IdentifierSchema).max(maximumImages),
  }).strict().superRefine((draft, context) => {
    if (!draft.text && draft.orderedAssetIds.length === 0) {
      context.addIssue({ code: 'custom', path: ['text'], message: 'Add post text or at least one image.' });
    }
    if (new Set(draft.orderedAssetIds).size !== draft.orderedAssetIds.length) {
      context.addIssue({ code: 'custom', path: ['orderedAssetIds'], message: 'Asset order contains duplicates.' });
    }
  });
}

export const BinanceSquarePostDraftPayloadSchema = postDraftPayloadSchema(
  BINANCE_POST_MAX_CHARACTERS,
  BINANCE_POST_MAX_IMAGES,
  'Binance Square',
);
export const XPostDraftPayloadSchema = postDraftPayloadSchema(
  X_POST_MAX_CHARACTERS,
  X_POST_MAX_IMAGES,
  'X',
);

/** Tolerant legacy shape used only to keep migrated drafts readable and repairable. */
const BinanceSquareStoredDraftPayloadSchema = z.object({
  title: z.string().trim().min(1).max(200),
  markdown: z.string().min(1).max(100_000),
  cover: z.object({
    assetId: IdentifierSchema.optional(),
    focalX: z.number().finite().min(0).max(1).default(0.5),
    focalY: z.number().finite().min(0).max(1).default(0.5),
    targetWidth: z.literal(1000).default(1000),
    targetHeight: z.literal(400).default(400),
  }).strict().default({ focalX: 0.5, focalY: 0.5, targetWidth: 1000, targetHeight: 400 }),
  orderedAssetIds: z.array(IdentifierSchema).max(10),
}).strict().superRefine((draft, context) => {
  const uniqueIds = new Set(draft.orderedAssetIds);
  if (uniqueIds.size !== draft.orderedAssetIds.length) {
    context.addIssue({ code: 'custom', path: ['orderedAssetIds'], message: 'Asset order contains duplicates.' });
  }
  for (const reference of draft.markdown.matchAll(/asset:([A-Za-z0-9][A-Za-z0-9_-]{0,199})/g)) {
    if (!uniqueIds.has(reference[1])) {
      context.addIssue({
        code: 'custom',
        path: ['markdown'],
        message: `Markdown references unordered asset ${reference[1]}.`,
      });
    }
  }
});

/** Legacy V2 Binance writes and preparation must still be locally publishable. */
export const BinanceSquareDraftPayloadSchema = BinanceSquareStoredDraftPayloadSchema
  .superRefine(validateArticleBodyReferences);
export const BinanceCompatibleArticleDraftPayloadSchema = z.union([
  ArticleDraftPayloadSchema,
  BinanceSquareStoredDraftPayloadSchema,
]);
/** @deprecated Use XPostDraftPayloadSchema. */
export const XDraftPayloadSchema = XPostDraftPayloadSchema;

export type ArticleDraftPayload = z.infer<typeof ArticleDraftPayloadSchema>;
export type BinanceSquareDraftPayload = z.infer<typeof BinanceSquareDraftPayloadSchema>;
export type XDraftPayload = z.infer<typeof XPostDraftPayloadSchema>;
export type PublicationPostDraftPayload = z.infer<typeof XPostDraftPayloadSchema>
  | z.infer<typeof BinanceSquarePostDraftPayloadSchema>;
export type PublicationDraftPayload = ArticleDraftPayload
  | BinanceSquareDraftPayload
  | PublicationPostDraftPayload;

export interface PublicationDraftRecord {
  id: string;
  workspaceId: string;
  articleId: string;
  target: PublicationTarget;
  kind?: PublicationKind;
  revision: number;
  status: string;
  payload: unknown;
  expiresAt: Date;
  publishedUrl: string | null;
  updatedAt: Date;
}

export interface PublicationDraftRepository {
  getDraft(input: {
    actorUserId: string;
    workspaceId: string;
    articleId: string;
    target: PublicationTarget;
    kind: PublicationKind;
  }): Promise<PublicationDraftRecord | null>;
  saveDraft(input: {
    actorUserId: string;
    workspaceId: string;
    articleId: string;
    target: PublicationTarget;
    kind: PublicationKind;
    draftId: string;
    expectedRevision: number;
    payload: PublicationDraftPayload;
    expiresAt: Date;
    now: Date;
  }): Promise<PublicationDraftRecord | null>;
}

export function defaultPublicationKind(target: PublicationTarget): PublicationKind {
  return target === 'x' ? 'post' : 'article';
}

function payloadSchema(
  target: PublicationTarget,
  kind: PublicationKind,
  options: { legacyBinanceArticle?: boolean; serializedRecord?: boolean } = {},
) {
  if (kind === 'article') {
    if (target === 'binance-square' && options.serializedRecord) {
      return BinanceCompatibleArticleDraftPayloadSchema;
    }
    if (target === 'binance-square' && options.legacyBinanceArticle) {
      return BinanceSquareDraftPayloadSchema;
    }
    return ArticleDraftPayloadSchema;
  }
  return target === 'x' ? XPostDraftPayloadSchema : BinanceSquarePostDraftPayloadSchema;
}

function invalidDraft(target: PublicationTarget): AppError {
  return new AppError({
    code: 'INVALID_PUBLICATION_DRAFT',
    message: target === 'x' ? 'The X publication draft is invalid.' : 'The Binance publication draft is invalid.',
    status: 400,
  });
}

export function serializePublicationDraft(record: PublicationDraftRecord | null) {
  if (!record) return null;
  const target = PublicationTargetSchema.parse(record.target);
  const kind = PublicationKindSchema.parse(record.kind ?? defaultPublicationKind(target));
  const payload = payloadSchema(target, kind, { serializedRecord: true }).parse(record.payload);
  return {
    id: IdentifierSchema.parse(record.id),
    workspaceId: IdentifierSchema.parse(record.workspaceId),
    articleId: IdentifierSchema.parse(record.articleId),
    target,
    kind,
    revision: z.number().int().positive().parse(record.revision),
    status: record.status,
    ...payload,
    expiresAt: record.expiresAt,
    publishedUrl: record.publishedUrl,
    updatedAt: record.updatedAt,
  };
}

export async function savePublicationDraft(input: {
  repository: PublicationDraftRepository;
  actorUserId: string;
  workspaceId: string;
  articleId: string;
  target: PublicationTarget;
  kind?: PublicationKind;
  draftId?: string;
  input: unknown;
  now?: Date;
}) {
  const target = PublicationTargetSchema.parse(input.target);
  const kind = PublicationKindSchema.parse(input.kind ?? defaultPublicationKind(target));
  const request = z.object({
    expectedRevision: ExpectedRevisionSchema,
    kind: PublicationKindSchema.optional(),
  }).passthrough().safeParse(input.input);
  const requestKindMatches = request.success && (
    request.data.kind === undefined || request.data.kind === kind
  );
  const legacyBinanceArticle = input.kind === undefined
    && target === 'binance-square'
    && kind === 'article';
  const parsedPayload = request.success
    ? payloadSchema(target, kind, { legacyBinanceArticle }).safeParse((({
      expectedRevision: _revision,
      kind: _kind,
      ...payload
    }) => payload)(request.data))
    : null;
  if (!request.success || !requestKindMatches || !parsedPayload?.success) throw invalidDraft(target);

  const now = input.now ?? new Date();
  const record = await input.repository.saveDraft({
    actorUserId: IdentifierSchema.parse(input.actorUserId),
    workspaceId: IdentifierSchema.parse(input.workspaceId),
    articleId: IdentifierSchema.parse(input.articleId),
    target,
    kind,
    draftId: IdentifierSchema.parse(input.draftId ?? crypto.randomUUID()),
    expectedRevision: request.data.expectedRevision,
    payload: parsedPayload.data,
    expiresAt: new Date(now.getTime() + PUBLICATION_DRAFT_LIFETIME_MS),
    now,
  });
  if (!record) {
    throw new AppError({
      code: 'PUBLICATION_REVISION_STALE',
      message: 'The publication draft changed. Reload it before saving again.',
      status: 409,
    });
  }
  return serializePublicationDraft(record)!;
}

export async function getPublicationDraft(input: {
  repository: PublicationDraftRepository;
  actorUserId: string;
  workspaceId: string;
  articleId: string;
  target: PublicationTarget;
  kind?: PublicationKind;
}) {
  const target = PublicationTargetSchema.parse(input.target);
  const record = await input.repository.getDraft({
    actorUserId: IdentifierSchema.parse(input.actorUserId),
    workspaceId: IdentifierSchema.parse(input.workspaceId),
    articleId: IdentifierSchema.parse(input.articleId),
    target,
    kind: PublicationKindSchema.parse(input.kind ?? defaultPublicationKind(target)),
  });
  return serializePublicationDraft(record);
}
