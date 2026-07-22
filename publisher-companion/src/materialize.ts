import sharp from 'sharp';

import {
  createBinanceBundle,
  getSlideImagePath,
  type BinanceBundleManifest,
} from '../../lib/binance-export';
import {
  getMarkdownImageReferenceErrors,
} from '../../.agents/skills/baoyu-post-to-binance-square/scripts/markdown-image-references';
import {
  validatePublicationRecipe,
  type BinanceSquarePublicationRecipeV2,
  type PublicationRecipeV1,
} from '../../server/domain/publication-recipe';

import { sha256Hex, sniffImageMimeType } from './asset-download';
import { cropBinanceCover } from './crop';

type BinancePublicationRecipe = PublicationRecipeV1 | BinanceSquarePublicationRecipeV2;
type PublicationAsset = BinancePublicationRecipe['assets'][number];

function requireBinancePublicationRecipe(input: {
  recipe: unknown;
  expectedRevision: number;
  now?: Date;
}): BinancePublicationRecipe {
  const recipe = validatePublicationRecipe(input.recipe, {
    expectedRevision: input.expectedRevision,
    now: input.now,
  });
  if (recipe.version === 1 || recipe.target === 'binance-square') return recipe;
  throw new Error('The publication recipe target does not match Binance Square.');
}

function assertCanonicalAssetReferences(recipe: BinancePublicationRecipe): void {
  const expected = recipe.orderedAssetIds.map((id) => `asset:${id}`);
  const errors = getMarkdownImageReferenceErrors(recipe.markdown, expected, 'Publication recipe');
  for (const id of recipe.orderedAssetIds) {
    if (recipe.markdown.split(`](asset:${id})`).length !== 2) {
      errors.push(`Publication recipe must reference asset:${id} exactly once in canonical form.`);
    }
  }
  if (errors.length > 0) throw new Error(errors[0]);
}

export async function materializePublicationBundle(input: {
  recipe: unknown;
  expectedRevision: number;
  downloadAsset: (asset: PublicationAsset) => Promise<Uint8Array>;
  now?: Date;
  exportedAt?: Date;
}): Promise<{ bundleBytes: Uint8Array; manifest: BinanceBundleManifest }> {
  const recipe = requireBinancePublicationRecipe(input);
  assertCanonicalAssetReferences(recipe);

  const downloaded = new Map<string, Uint8Array>();
  for (const asset of recipe.assets) {
    const bytes = await input.downloadAsset(asset);
    if (
      bytes.byteLength !== asset.sizeBytes
      || await sha256Hex(bytes) !== asset.sha256
      || sniffImageMimeType(bytes) !== asset.mimeType
    ) {
      throw new Error('Publisher asset integrity verification failed.');
    }
    downloaded.set(asset.id, bytes);
  }

  const assetsById = new Map(recipe.assets.map((asset) => [asset.id, asset]));
  const coverSource = downloaded.get(recipe.cover.assetId);
  if (!coverSource) throw new Error('Publication cover asset is missing.');
  const cover = await cropBinanceCover({
    bytes: coverSource,
    focalX: recipe.cover.focalX,
    focalY: recipe.cover.focalY,
  });

  let markdown = recipe.markdown;
  const images = [];
  for (const [order, assetId] of recipe.orderedAssetIds.entries()) {
    const metadata = assetsById.get(assetId);
    const bytes = downloaded.get(assetId);
    if (!metadata || !bytes) throw new Error('Publication body asset is missing.');
    const path = getSlideImagePath(order, metadata.mimeType);
    markdown = markdown.replace(`](asset:${assetId})`, `](${path})`);
    const imageMetadata = await sharp(bytes, {
      failOn: 'error',
      limitInputPixels: 40_000_000,
    }).metadata();
    if (!imageMetadata.width || !imageMetadata.height) {
      throw new Error('Publication image dimensions are unavailable.');
    }
    images.push({
      slideId: assetId,
      order,
      path,
      bytes,
      mimeType: metadata.mimeType,
      width: imageMetadata.width,
      height: imageMetadata.height,
    });
  }

  const created = await createBinanceBundle({
    articleId: recipe.articleId,
    exportedAt: input.exportedAt,
    title: recipe.title,
    markdown,
    cover: {
      sourceSlideId: recipe.cover.assetId,
      bytes: cover,
      mimeType: 'image/jpeg',
      width: 1000,
      height: 400,
    },
    images,
  });
  return { bundleBytes: created.bytes, manifest: created.manifest };
}
