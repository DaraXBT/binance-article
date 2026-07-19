import { z } from 'zod';

import {
  PublicationRecipeV1Schema,
  hashPublicationRecipe,
  type PublicationRecipeV1,
} from '@/server/domain/publication-recipe';
import { UserQuotaSchema } from '@/server/domain/quotas';
import { AppError } from '@/server/http/errors';

export const PUBLISHER_DEVICE_ONLINE_WINDOW_MS = 2 * 60 * 1000;
const GLOBAL_MAX_SLIDES = 10;

const IdentifierSchema = z.string().trim().min(1).max(200);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const PreparationContextSchema = z.object({
  draft: z.object({
    id: IdentifierSchema,
    workspaceId: IdentifierSchema,
    articleId: IdentifierSchema,
    revision: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
    markdown: z.string().min(1).max(100_000),
    cover: z.object({
      assetId: IdentifierSchema,
      focalX: z.number().finite().min(0).max(1),
      focalY: z.number().finite().min(0).max(1),
      targetWidth: z.literal(1000),
      targetHeight: z.literal(400),
    }).strict(),
    orderedAssetIds: z.array(IdentifierSchema).max(GLOBAL_MAX_SLIDES),
    expiresAt: z.date(),
  }).strict(),
  assets: z.array(z.object({
    id: IdentifierSchema,
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
    sha256: Sha256Schema,
  }).strict()).max(GLOBAL_MAX_SLIDES + 1),
  quota: UserQuotaSchema,
  device: z.object({
    id: IdentifierSchema,
    status: z.enum(['pending', 'active', 'revoked']),
    lastSeenAt: z.date().nullable(),
  }).strict().nullable(),
}).strict();

export type BinancePreparationContext = z.infer<typeof PreparationContextSchema>;

export interface PreparedPublisherCommand {
  id: string;
  draftId: string;
  deviceId: string;
  state: 'queued';
  revision: number;
  recipeHash: string;
  expiresAt: Date;
}

export interface BinancePublicationRepository {
  loadPreparationContext(input: {
    actorUserId: string;
    workspaceId: string;
    articleId: string;
  }): Promise<BinancePreparationContext | null>;
  commitPreparedPublication(input: {
    actorUserId: string;
    workspaceId: string;
    expectedRevision: number;
    recipeHash: string;
    command: PreparedPublisherCommand;
  }): Promise<boolean>;
}

function fail(code: string, message: string, status = 409): never {
  throw new AppError({ code, message, status });
}

export async function prepareBinancePublication(input: {
  repository: BinancePublicationRepository;
  actorUserId: string;
  workspaceId: string;
  articleId: string;
  expectedRevision: number;
  commandId?: string;
  now?: Date;
}): Promise<{
  recipe: PublicationRecipeV1;
  recipeHash: string;
  command: PreparedPublisherCommand;
}> {
  const actorUserId = IdentifierSchema.parse(input.actorUserId);
  const workspaceId = IdentifierSchema.parse(input.workspaceId);
  const articleId = IdentifierSchema.parse(input.articleId);
  const commandId = IdentifierSchema.parse(input.commandId ?? crypto.randomUUID());
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision <= 0) {
    fail('PUBLICATION_REVISION_STALE', 'The publication draft revision is stale.');
  }
  const now = input.now ?? new Date();
  const loaded = await input.repository.loadPreparationContext({ actorUserId, workspaceId, articleId });
  if (!loaded) fail('PUBLICATION_NOT_FOUND', 'Publication draft not found.', 404);

  const { draft, assets, quota, device } = PreparationContextSchema.parse(loaded);
  if (draft.workspaceId !== workspaceId || draft.articleId !== articleId) {
    fail('PUBLICATION_NOT_FOUND', 'Publication draft not found.', 404);
  }
  if (draft.revision !== input.expectedRevision || draft.expiresAt.getTime() <= now.getTime()) {
    fail('PUBLICATION_REVISION_STALE', 'The publication draft revision is stale.');
  }
  if (!quota.publishingEnabled) fail('PUBLISHING_DISABLED', 'Publishing is disabled for this account.', 403);
  if (draft.orderedAssetIds.length > quota.maxSlidesPerArticle || draft.orderedAssetIds.length > GLOBAL_MAX_SLIDES) {
    fail('SLIDE_LIMIT', 'The publication exceeds the allowed slide count.');
  }
  if (
    !device ||
    device.status !== 'active' ||
    !device.lastSeenAt ||
    device.lastSeenAt.getTime() <= now.getTime() - PUBLISHER_DEVICE_ONLINE_WINDOW_MS
  ) {
    fail('PUBLISHER_DEVICE_OFFLINE', 'An active local publisher must be online.');
  }

  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const usedAssetIds = [...new Set([draft.cover.assetId, ...draft.orderedAssetIds])];
  const recipeAssets = usedAssetIds.map((id) => assetsById.get(id));
  if (recipeAssets.some((asset) => !asset)) {
    fail('PUBLICATION_ASSET_MISSING', 'A publication asset is missing or unavailable.');
  }

  const recipe = PublicationRecipeV1Schema.parse({
    version: 1,
    draftId: draft.id,
    articleId: draft.articleId,
    revision: draft.revision,
    expiresAt: draft.expiresAt.toISOString(),
    title: draft.title,
    markdown: draft.markdown,
    cover: draft.cover,
    orderedAssetIds: draft.orderedAssetIds,
    assets: recipeAssets,
  });
  const recipeHash = await hashPublicationRecipe(recipe);
  const command: PreparedPublisherCommand = {
    id: commandId,
    draftId: draft.id,
    deviceId: device.id,
    state: 'queued',
    revision: draft.revision,
    recipeHash,
    expiresAt: draft.expiresAt,
  };

  const committed = await input.repository.commitPreparedPublication({
    actorUserId,
    workspaceId,
    expectedRevision: draft.revision,
    recipeHash,
    command,
  });
  if (!committed) fail('PUBLICATION_REVISION_STALE', 'The publication draft changed during preparation.');
  return { recipe, recipeHash, command };
}
