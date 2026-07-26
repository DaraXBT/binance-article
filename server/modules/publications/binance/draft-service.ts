import { z } from 'zod';

import { PUBLICATION_DRAFT_LIFETIME_MS } from '@/server/domain/publication-recipe';
import { AppError } from '@/server/http/errors';

// Must match the strict schema in ../draft-service.ts — the prepare path
// re-parses the stored payload with it, so anything looser saved here would
// make the draft permanently un-preparable.
const IdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/);

const DraftInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative().safe(),
  title: z.string().trim().min(1).max(200),
  markdown: z.string().min(1).max(100_000),
  cover: z.object({
    assetId: IdentifierSchema.optional(),
    focalX: z.number().finite().min(0).max(1),
    focalY: z.number().finite().min(0).max(1),
  }).strict(),
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

export type SaveBinanceDraftInput = z.infer<typeof DraftInputSchema>;

export interface BinanceDraftRecord {
  revision: number;
  [key: string]: unknown;
}

export interface BinanceDraftRepository {
  getDraft(input: {
    actorUserId: string;
    workspaceId: string;
    articleId: string;
  }): Promise<BinanceDraftRecord | null>;
  saveDraft(input: {
    actorUserId: string;
    workspaceId: string;
    articleId: string;
    draftId: string;
    expectedRevision: number;
    title: string;
    markdown: string;
    cover: {
      assetId?: string;
      focalX: number;
      focalY: number;
      targetWidth: 1000;
      targetHeight: 400;
    };
    orderedAssetIds: string[];
    expiresAt: Date;
    now: Date;
  }): Promise<BinanceDraftRecord | null>;
}

function invalidDraft(): AppError {
  return new AppError({
    code: 'INVALID_PUBLICATION_DRAFT',
    message: 'The Binance publication draft is invalid.',
    status: 400,
  });
}

export async function saveBinanceDraft(input: {
  repository: BinanceDraftRepository;
  actorUserId: string;
  workspaceId: string;
  articleId: string;
  draftId?: string;
  input: unknown;
  now?: Date;
}) {
  const actorUserId = IdentifierSchema.parse(input.actorUserId);
  const workspaceId = IdentifierSchema.parse(input.workspaceId);
  const articleId = IdentifierSchema.parse(input.articleId);
  const draftId = IdentifierSchema.parse(input.draftId ?? crypto.randomUUID());
  const parsed = DraftInputSchema.safeParse(input.input);
  if (!parsed.success) throw invalidDraft();
  const now = input.now ?? new Date();
  const saved = await input.repository.saveDraft({
    actorUserId,
    workspaceId,
    articleId,
    draftId,
    expectedRevision: parsed.data.expectedRevision,
    title: parsed.data.title,
    markdown: parsed.data.markdown,
    cover: { ...parsed.data.cover, targetWidth: 1000, targetHeight: 400 },
    orderedAssetIds: parsed.data.orderedAssetIds,
    expiresAt: new Date(now.getTime() + PUBLICATION_DRAFT_LIFETIME_MS),
    now,
  });
  if (!saved) {
    throw new AppError({
      code: 'PUBLICATION_REVISION_STALE',
      message: 'The publication draft changed. Reload it before saving again.',
      status: 409,
    });
  }
  return saved;
}

export function getBinanceDraft(input: {
  repository: BinanceDraftRepository;
  actorUserId: string;
  workspaceId: string;
  articleId: string;
}) {
  return input.repository.getDraft({
    actorUserId: IdentifierSchema.parse(input.actorUserId),
    workspaceId: IdentifierSchema.parse(input.workspaceId),
    articleId: IdentifierSchema.parse(input.articleId),
  });
}
