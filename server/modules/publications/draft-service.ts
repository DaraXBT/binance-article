import { z } from 'zod';

import {
  PUBLICATION_DRAFT_LIFETIME_MS,
  PublicationTargetSchema,
  X_POST_MAX_CHARACTERS,
  X_POST_MAX_IMAGES,
  type PublicationTarget,
} from '@/server/domain/publication-recipe';
import { AppError } from '@/server/http/errors';

const IdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/);
const ExpectedRevisionSchema = z.number().int().nonnegative().safe();

export const BinanceSquareDraftPayloadSchema = z.object({
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

export const XDraftPayloadSchema = z.object({
  text: z.string().trim().refine(
    (value) => [...value].length <= X_POST_MAX_CHARACTERS,
    `X post text must be ${X_POST_MAX_CHARACTERS} characters or fewer.`,
  ),
  orderedAssetIds: z.array(IdentifierSchema).max(X_POST_MAX_IMAGES),
}).strict().superRefine((draft, context) => {
  if (!draft.text && draft.orderedAssetIds.length === 0) {
    context.addIssue({ code: 'custom', path: ['text'], message: 'Add post text or at least one image.' });
  }
  if (new Set(draft.orderedAssetIds).size !== draft.orderedAssetIds.length) {
    context.addIssue({ code: 'custom', path: ['orderedAssetIds'], message: 'Asset order contains duplicates.' });
  }
});

export type BinanceSquareDraftPayload = z.infer<typeof BinanceSquareDraftPayloadSchema>;
export type XDraftPayload = z.infer<typeof XDraftPayloadSchema>;
export type PublicationDraftPayload = BinanceSquareDraftPayload | XDraftPayload;

export interface PublicationDraftRecord {
  id: string;
  workspaceId: string;
  articleId: string;
  target: PublicationTarget;
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
  }): Promise<PublicationDraftRecord | null>;
  saveDraft(input: {
    actorUserId: string;
    workspaceId: string;
    articleId: string;
    target: PublicationTarget;
    draftId: string;
    expectedRevision: number;
    payload: PublicationDraftPayload;
    expiresAt: Date;
    now: Date;
  }): Promise<PublicationDraftRecord | null>;
}

function payloadSchema(target: PublicationTarget) {
  return target === 'binance-square' ? BinanceSquareDraftPayloadSchema : XDraftPayloadSchema;
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
  const payload = payloadSchema(target).parse(record.payload);
  return {
    id: IdentifierSchema.parse(record.id),
    workspaceId: IdentifierSchema.parse(record.workspaceId),
    articleId: IdentifierSchema.parse(record.articleId),
    target,
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
  draftId?: string;
  input: unknown;
  now?: Date;
}) {
  const target = PublicationTargetSchema.parse(input.target);
  const request = z.object({
    expectedRevision: ExpectedRevisionSchema,
  }).passthrough().safeParse(input.input);
  const parsedPayload = request.success
    ? payloadSchema(target).safeParse((({ expectedRevision: _revision, ...payload }) => payload)(request.data))
    : null;
  if (!request.success || !parsedPayload?.success) throw invalidDraft(target);

  const now = input.now ?? new Date();
  const record = await input.repository.saveDraft({
    actorUserId: IdentifierSchema.parse(input.actorUserId),
    workspaceId: IdentifierSchema.parse(input.workspaceId),
    articleId: IdentifierSchema.parse(input.articleId),
    target,
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
}) {
  const record = await input.repository.getDraft({
    actorUserId: IdentifierSchema.parse(input.actorUserId),
    workspaceId: IdentifierSchema.parse(input.workspaceId),
    articleId: IdentifierSchema.parse(input.articleId),
    target: PublicationTargetSchema.parse(input.target),
  });
  return serializePublicationDraft(record);
}
