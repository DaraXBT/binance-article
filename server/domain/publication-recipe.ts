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
    }
  }

  const coverAsset = assetsById.get(recipe.cover.assetId);
  if (!coverAsset) {
    context.addIssue({
      code: 'custom',
      path: ['cover', 'assetId'],
      message: 'Cover metadata is missing.',
    });
  }

  const usedAssetIds = new Set([...orderedIds, recipe.cover.assetId]);
  if (recipe.assets.some((asset) => !usedAssetIds.has(asset.id))) {
    context.addIssue({
      code: 'custom',
      path: ['assets'],
      message: 'Every asset must be used by the cover or article body.',
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

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON cannot contain non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  throw new TypeError('Canonical JSON contains an unsupported value.');
}

export function canonicalizePublicationRecipe(input: unknown): string {
  return canonicalJson(PublicationRecipeV1Schema.parse(input));
}

export async function hashPublicationRecipe(input: unknown): Promise<string> {
  const canonical = canonicalizePublicationRecipe(input);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

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
