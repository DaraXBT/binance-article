import { z } from 'zod';

import {
  PublicationRecipeV2Schema,
  PublicationTargetSchema,
  hashPublicationRecipe,
  type PublicationRecipeV2,
  type PublicationTarget,
} from '@/server/domain/publication-recipe';
import { UserQuotaSchema } from '@/server/domain/quotas';
import { AppError } from '@/server/http/errors';

import {
  BinanceSquareDraftPayloadSchema,
  XDraftPayloadSchema,
} from './draft-service';

export const PUBLISHER_DEVICE_ONLINE_WINDOW_MS = 2 * 60 * 1000;
const GLOBAL_MAX_SLIDES = 10;

const IdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const PreparationContextSchema = z.object({
  draft: z.object({
    id: IdentifierSchema,
    workspaceId: IdentifierSchema,
    articleId: IdentifierSchema,
    target: PublicationTargetSchema,
    revision: z.number().int().positive(),
    payload: z.unknown(),
    expiresAt: z.date(),
  }).strict(),
  assets: z.array(z.object({
    id: IdentifierSchema,
    purpose: z.string(),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
    sha256: Sha256Schema,
  }).strict()).max(GLOBAL_MAX_SLIDES + 1),
  generatedCoverAssetId: IdentifierSchema.nullable(),
  quota: UserQuotaSchema,
  device: z.object({
    id: IdentifierSchema,
    status: z.enum(['pending', 'active', 'revoked']),
    lastSeenAt: z.date().nullable(),
  }).strict().nullable(),
}).strict();

export type PublicationPreparationContext = z.infer<typeof PreparationContextSchema>;

export interface PreparedPublisherCommand {
  id: string;
  draftId: string;
  deviceId: string;
  target: PublicationTarget;
  state: 'queued';
  revision: number;
  recipeHash: string;
  expiresAt: Date;
}

export interface PublicationRepository {
  loadPreparationContext(input: {
    actorUserId: string;
    workspaceId: string;
    articleId: string;
    target: PublicationTarget;
  }): Promise<PublicationPreparationContext | null>;
  commitPreparedPublication(input: {
    actorUserId: string;
    workspaceId: string;
    target: PublicationTarget;
    expectedRevision: number;
    recipeHash: string;
    recipe: PublicationRecipeV2;
    command: PreparedPublisherCommand;
  }): Promise<boolean>;
}

function fail(code: string, message: string, status = 409): never {
  throw new AppError({ code, message, status });
}

export async function preparePublication(input: {
  repository: PublicationRepository;
  actorUserId: string;
  workspaceId: string;
  articleId: string;
  target: PublicationTarget;
  expectedRevision: number;
  commandId?: string;
  now?: Date;
}): Promise<{
  recipe: PublicationRecipeV2;
  recipeHash: string;
  command: PreparedPublisherCommand;
}> {
  const actorUserId = IdentifierSchema.parse(input.actorUserId);
  const workspaceId = IdentifierSchema.parse(input.workspaceId);
  const articleId = IdentifierSchema.parse(input.articleId);
  const target = PublicationTargetSchema.parse(input.target);
  const commandId = IdentifierSchema.parse(input.commandId ?? crypto.randomUUID());
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision <= 0) {
    fail('PUBLICATION_REVISION_STALE', 'The publication draft revision is stale.');
  }
  const now = input.now ?? new Date();
  const loaded = await input.repository.loadPreparationContext({
    actorUserId,
    workspaceId,
    articleId,
    target,
  });
  if (!loaded) fail('PUBLICATION_NOT_FOUND', 'Publication draft not found.', 404);

  const { draft, assets, generatedCoverAssetId, quota, device } = PreparationContextSchema.parse(loaded);
  if (draft.workspaceId !== workspaceId || draft.articleId !== articleId || draft.target !== target) {
    fail('PUBLICATION_NOT_FOUND', 'Publication draft not found.', 404);
  }
  if (draft.revision !== input.expectedRevision || draft.expiresAt.getTime() <= now.getTime()) {
    fail('PUBLICATION_REVISION_STALE', 'The publication draft revision is stale.');
  }
  if (!quota.publishingEnabled) fail('PUBLISHING_DISABLED', 'Publishing is disabled for this account.', 403);
  if (
    !device
    || device.status !== 'active'
    || !device.lastSeenAt
    || device.lastSeenAt.getTime() <= now.getTime() - PUBLISHER_DEVICE_ONLINE_WINDOW_MS
  ) {
    fail('PUBLISHER_DEVICE_OFFLINE', 'An active local publisher must be online.');
  }

  const binancePayload = target === 'binance-square'
    ? BinanceSquareDraftPayloadSchema.parse(draft.payload)
    : null;
  const xPayload = target === 'x' ? XDraftPayloadSchema.parse(draft.payload) : null;
  const orderedAssetIds = binancePayload?.orderedAssetIds ?? xPayload!.orderedAssetIds;
  if (
    target === 'binance-square'
    && (orderedAssetIds.length > quota.maxSlidesPerArticle
      || orderedAssetIds.length > GLOBAL_MAX_SLIDES)
  ) {
    fail('SLIDE_LIMIT', 'The publication exceeds the allowed slide count.');
  }
  if (target === 'binance-square' && !generatedCoverAssetId) {
    fail(
      'PUBLICATION_COVER_NOT_READY',
      'Generate the dedicated article cover before preparing this publication.',
    );
  }

  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const usedAssetIds = target === 'binance-square'
    ? [...new Set([generatedCoverAssetId!, ...orderedAssetIds])]
    : [...new Set(orderedAssetIds)];
  const recipeAssetsWithPurpose = usedAssetIds.map((id) => assetsById.get(id));
  if (recipeAssetsWithPurpose.some((asset) => !asset)) {
    fail('PUBLICATION_ASSET_MISSING', 'A publication asset is missing or unavailable.');
  }
  if (
    target === 'binance-square'
    && assetsById.get(generatedCoverAssetId!)?.purpose !== 'cover_image'
  ) {
    fail('PUBLICATION_COVER_NOT_READY', 'The dedicated article cover is unavailable.');
  }
  const recipeAssets = recipeAssetsWithPurpose.map((asset) => ({
    id: asset!.id,
    mimeType: asset!.mimeType,
    sizeBytes: asset!.sizeBytes,
    sha256: asset!.sha256,
  }));

  const recipe = PublicationRecipeV2Schema.parse(target === 'binance-square'
    ? {
      version: 2,
      target,
      draftId: draft.id,
      articleId: draft.articleId,
      revision: draft.revision,
      expiresAt: draft.expiresAt.toISOString(),
      title: binancePayload!.title,
      markdown: binancePayload!.markdown,
      cover: {
        assetId: generatedCoverAssetId,
        focalX: binancePayload!.cover.focalX,
        focalY: binancePayload!.cover.focalY,
        targetWidth: 1000,
        targetHeight: 400,
      },
      orderedAssetIds,
      assets: recipeAssets,
    }
    : {
      version: 2,
      target,
      draftId: draft.id,
      articleId: draft.articleId,
      revision: draft.revision,
      expiresAt: draft.expiresAt.toISOString(),
      text: xPayload!.text,
      orderedAssetIds,
      assets: recipeAssets,
    });
  const recipeHash = await hashPublicationRecipe(recipe);
  const command: PreparedPublisherCommand = {
    id: commandId,
    draftId: draft.id,
    deviceId: device.id,
    target,
    state: 'queued',
    revision: draft.revision,
    recipeHash,
    expiresAt: draft.expiresAt,
  };
  const committed = await input.repository.commitPreparedPublication({
    actorUserId,
    workspaceId,
    target,
    expectedRevision: draft.revision,
    recipeHash,
    recipe,
    command,
  });
  if (!committed) fail('PUBLICATION_REVISION_STALE', 'The publication draft changed during preparation.');
  return { recipe, recipeHash, command };
}

export function prepareBinanceSquarePublication(
  input: Omit<Parameters<typeof preparePublication>[0], 'target'>,
) {
  return preparePublication({ ...input, target: 'binance-square' });
}

export function prepareXPublication(
  input: Omit<Parameters<typeof preparePublication>[0], 'target'>,
) {
  return preparePublication({ ...input, target: 'x' });
}
