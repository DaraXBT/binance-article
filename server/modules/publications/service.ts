import { z } from 'zod';

import {
  PublicationKindSchema,
  PublicationRecipeV2Schema,
  PublicationRecipeV3Schema,
  PublicationTargetSchema,
  hashPublicationRecipe,
  type PublicationKind,
  type PublicationRecipeV2,
  type PublicationRecipeV3,
  type PublicationTarget,
} from '@/server/domain/publication-recipe';
import { UserQuotaSchema } from '@/server/domain/quotas';
import { AppError } from '@/server/http/errors';

import {
  ArticleDraftPayloadSchema,
  BinanceCompatibleArticleDraftPayloadSchema,
  BinanceSquarePostDraftPayloadSchema,
  BinanceSquareDraftPayloadSchema,
  XPostDraftPayloadSchema,
  XDraftPayloadSchema,
  defaultPublicationKind,
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
    kind: PublicationKindSchema.optional(),
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
    protocolVersion: z.number().int().positive().optional(),
  }).strict().nullable(),
}).strict();

export type PublicationPreparationContext = z.infer<typeof PreparationContextSchema>;

export interface PreparedPublisherCommand {
  id: string;
  draftId: string;
  deviceId: string;
  target: PublicationTarget;
  kind?: PublicationKind;
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
    kind: PublicationKind;
    preferredProtocolVersion?: number;
  }): Promise<PublicationPreparationContext | null>;
  commitPreparedPublication(input: {
    actorUserId: string;
    workspaceId: string;
    target: PublicationTarget;
    kind?: PublicationKind;
    expectedRevision: number;
    recipeHash: string;
    recipe: PublicationRecipeV2 | PublicationRecipeV3;
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
  kind?: PublicationKind;
  expectedRevision: number;
  commandId?: string;
  now?: Date;
}): Promise<{
  recipe: PublicationRecipeV2 | PublicationRecipeV3;
  recipeHash: string;
  command: PreparedPublisherCommand;
}> {
  const actorUserId = IdentifierSchema.parse(input.actorUserId);
  const workspaceId = IdentifierSchema.parse(input.workspaceId);
  const articleId = IdentifierSchema.parse(input.articleId);
  const target = PublicationTargetSchema.parse(input.target);
  const legacyRecipe = input.kind === undefined;
  const kind = PublicationKindSchema.parse(input.kind ?? defaultPublicationKind(target));
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
    kind,
    ...(!legacyRecipe ? { preferredProtocolVersion: 2 } : {}),
  });
  if (!loaded) fail('PUBLICATION_NOT_FOUND', 'Publication draft not found.', 404);

  const { draft, assets, generatedCoverAssetId, quota, device } = PreparationContextSchema.parse(loaded);
  const draftKind = PublicationKindSchema.parse(draft.kind ?? defaultPublicationKind(draft.target));
  if (
    draft.workspaceId !== workspaceId
    || draft.articleId !== articleId
    || draft.target !== target
    || draftKind !== kind
  ) {
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
  if (!legacyRecipe && (device.protocolVersion ?? 1) < 2) {
    fail(
      'PUBLISHER_UPGRADE_REQUIRED',
      'Update the local publisher before preparing this publication.',
    );
  }

  const articlePayload = kind === 'article'
    ? (legacyRecipe
      ? BinanceSquareDraftPayloadSchema.parse(draft.payload)
      : target === 'binance-square'
        ? BinanceCompatibleArticleDraftPayloadSchema.parse(draft.payload)
        : ArticleDraftPayloadSchema.parse(draft.payload))
    : null;
  const postPayload = kind === 'post'
    ? (target === 'x'
      ? (legacyRecipe
        ? XDraftPayloadSchema.parse(draft.payload)
        : XPostDraftPayloadSchema.parse(draft.payload))
      : BinanceSquarePostDraftPayloadSchema.parse(draft.payload))
    : null;
  const orderedAssetIds = articlePayload?.orderedAssetIds ?? postPayload!.orderedAssetIds;
  if (
    kind === 'article'
    && (orderedAssetIds.length > quota.maxSlidesPerArticle
      || orderedAssetIds.length > GLOBAL_MAX_SLIDES)
  ) {
    fail('SLIDE_LIMIT', 'The publication exceeds the allowed slide count.');
  }
  if (legacyRecipe && target === 'binance-square' && !generatedCoverAssetId) {
    fail(
      'PUBLICATION_COVER_NOT_READY',
      'Generate the dedicated article cover before preparing this publication.',
    );
  }

  const selectedCover = !legacyRecipe
    && kind === 'article'
    && articlePayload?.cover
    && typeof articlePayload.cover.assetId === 'string'
    ? { ...articlePayload.cover, assetId: articlePayload.cover.assetId }
    : undefined;
  const coverAssetId = legacyRecipe && target === 'binance-square'
    ? generatedCoverAssetId
    : selectedCover?.assetId ?? null;
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const usedAssetIds = [...new Set([
    ...(coverAssetId ? [coverAssetId] : []),
    ...orderedAssetIds,
  ])];
  const recipeAssetsWithPurpose = usedAssetIds.map((id) => assetsById.get(id));
  if (recipeAssetsWithPurpose.some((asset) => !asset)) {
    fail('PUBLICATION_ASSET_MISSING', 'A publication asset is missing or unavailable.');
  }
  if (
    coverAssetId
    && assetsById.get(coverAssetId)?.purpose !== 'cover_image'
  ) {
    fail('PUBLICATION_COVER_NOT_READY', 'The dedicated article cover is unavailable.');
  }
  const recipeAssets = recipeAssetsWithPurpose.map((asset) => ({
    id: asset!.id,
    mimeType: asset!.mimeType,
    sizeBytes: asset!.sizeBytes,
    sha256: asset!.sha256,
  }));

  const recipeCommon = {
    draftId: draft.id,
    articleId: draft.articleId,
    revision: draft.revision,
    expiresAt: draft.expiresAt.toISOString(),
    orderedAssetIds,
    assets: recipeAssets,
  };
  const recipe: PublicationRecipeV2 | PublicationRecipeV3 = legacyRecipe
    ? PublicationRecipeV2Schema.parse(target === 'binance-square'
      ? {
        ...recipeCommon,
        version: 2,
        target,
        title: articlePayload!.title,
        markdown: articlePayload!.markdown,
        cover: {
          assetId: generatedCoverAssetId,
          focalX: articlePayload!.cover!.focalX,
          focalY: articlePayload!.cover!.focalY,
          targetWidth: 1000,
          targetHeight: 400,
        },
      }
      : {
        ...recipeCommon,
        version: 2,
        target,
        text: postPayload!.text,
      })
    : PublicationRecipeV3Schema.parse(kind === 'post'
      ? {
        ...recipeCommon,
        version: 3,
        target,
        kind,
        text: postPayload!.text,
      }
      : {
        ...recipeCommon,
        version: 3,
        target,
        kind,
        title: articlePayload!.title,
        markdown: articlePayload!.markdown,
        ...(selectedCover ? { cover: selectedCover } : {}),
      });
  const recipeHash = await hashPublicationRecipe(recipe);
  const command: PreparedPublisherCommand = {
    id: commandId,
    draftId: draft.id,
    deviceId: device.id,
    target,
    ...(!legacyRecipe ? { kind } : {}),
    state: 'queued',
    revision: draft.revision,
    recipeHash,
    expiresAt: draft.expiresAt,
  };
  const committed = await input.repository.commitPreparedPublication({
    actorUserId,
    workspaceId,
    target,
    kind,
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
