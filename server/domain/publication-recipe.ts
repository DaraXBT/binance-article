import { z } from 'zod';

export const PUBLICATION_DRAFT_LIFETIME_MS = 15 * 60 * 1000;

const MAX_ARTICLE_CHARACTERS = 100_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_BODY_ASSETS = 10;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const IdentifierSchema = z.string().regex(IDENTIFIER_PATTERN);

export const PublicationAssetV1Schema = z.object({
  id: IdentifierSchema,
  role: z.enum(['cover', 'body']),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  sha256: z.string().regex(SHA256_PATTERN),
}).strict();

export const PublicationCoverV1Schema = z.object({
  assetId: IdentifierSchema,
  focalX: z.number().finite().min(0).max(1),
  focalY: z.number().finite().min(0).max(1),
  targetWidth: z.literal(1000),
  targetHeight: z.literal(400),
}).strict();

export const PublicationRecipeV1Schema = z.object({
  version: z.literal(1),
  draftId: IdentifierSchema,
  articleId: IdentifierSchema,
  revision: z.number().int().nonnegative().safe(),
  expiresAt: z.string().datetime({ offset: true }),
  title: z.string().trim().min(1).max(200),
  markdown: z.string().min(1).max(MAX_ARTICLE_CHARACTERS),
  cover: PublicationCoverV1Schema,
  orderedAssetIds: z.array(IdentifierSchema).max(MAX_BODY_ASSETS),
  assets: z.array(PublicationAssetV1Schema).min(1).max(MAX_BODY_ASSETS + 1),
}).strict().superRefine((recipe, context) => {
  const assetsById = new Map<string, z.infer<typeof PublicationAssetV1Schema>>();
  for (const asset of recipe.assets) {
    if (assetsById.has(asset.id)) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: `Asset metadata contains duplicate ID ${asset.id}.`,
      });
    }
    assetsById.set(asset.id, asset);
  }

  const orderedIds = new Set<string>();
  for (const [index, assetId] of recipe.orderedAssetIds.entries()) {
    if (orderedIds.has(assetId)) {
      context.addIssue({
        code: 'custom',
        path: ['orderedAssetIds', index],
        message: `Ordered asset ID ${assetId} is duplicated.`,
      });
    }
    orderedIds.add(assetId);

    const asset = assetsById.get(assetId);
    if (!asset) {
      context.addIssue({
        code: 'custom',
        path: ['orderedAssetIds', index],
        message: `Ordered asset ID ${assetId} has no metadata.`,
      });
    } else if (asset.role !== 'body') {
      context.addIssue({
        code: 'custom',
        path: ['orderedAssetIds', index],
        message: 'The cover asset cannot appear in the body asset order.',
      });
    }
  }

  const coverAsset = assetsById.get(recipe.cover.assetId);
  if (!coverAsset || coverAsset.role !== 'cover') {
    context.addIssue({
      code: 'custom',
      path: ['cover', 'assetId'],
      message: 'Cover metadata is missing or does not have the cover role.',
    });
  }

  const coverAssets = recipe.assets.filter((asset) => asset.role === 'cover');
  if (coverAssets.length !== 1 || coverAssets[0]?.id !== recipe.cover.assetId) {
    context.addIssue({
      code: 'custom',
      path: ['assets'],
      message: 'Recipe must contain exactly one matching cover asset.',
    });
  }

  const bodyAssetIds = recipe.assets.filter((asset) => asset.role === 'body').map((asset) => asset.id);
  if (bodyAssetIds.length !== orderedIds.size || bodyAssetIds.some((assetId) => !orderedIds.has(assetId))) {
    context.addIssue({
      code: 'custom',
      path: ['orderedAssetIds'],
      message: 'Every body asset must appear exactly once in the body asset order.',
    });
  }

  for (const reference of recipe.markdown.matchAll(/asset:([A-Za-z0-9][A-Za-z0-9_-]{0,199})/g)) {
    const assetId = reference[1];
    if (!orderedIds.has(assetId)) {
      context.addIssue({
        code: 'custom',
        path: ['markdown'],
        message: `Markdown references unknown body asset ${assetId}.`,
      });
    }
  }
});

export type PublicationRecipeV1 = z.infer<typeof PublicationRecipeV1Schema>;

export function validatePublicationRecipe(
  input: unknown,
  options: { now?: Date; expectedRevision: number },
): PublicationRecipeV1 {
  const recipe = PublicationRecipeV1Schema.parse(input);
  const now = options.now ?? new Date();

  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Publication recipe validation requires a valid current time.');
  }
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) {
    throw new TypeError('Expected publication revision is invalid.');
  }
  if (recipe.revision !== options.expectedRevision) {
    throw new Error('Publication recipe revision does not match the current article revision.');
  }
  if (Date.parse(recipe.expiresAt) <= now.getTime()) {
    throw new Error('Publication recipe has expired.');
  }

  return recipe;
}
