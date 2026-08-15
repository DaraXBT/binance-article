import JSZip from 'jszip';
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
  type PublicationRecipeV3,
  type PublicationRecipeV1,
} from '../../server/domain/publication-recipe';

import { sha256Hex, sniffImageMimeType } from './asset-download';
import { cropBinanceCover } from './crop';

type BinancePublicationRecipeV3 = Extract<PublicationRecipeV3, { target: 'binance-square' }>;
type BinancePublicationRecipe = PublicationRecipeV1 | BinanceSquarePublicationRecipeV2 | BinancePublicationRecipeV3;
type PublicationAsset = BinancePublicationRecipe['assets'][number];

type MaterializeInput<Recipe = unknown> = {
  recipe: Recipe;
  expectedRevision: number;
  downloadAsset: (asset: PublicationAsset) => Promise<Uint8Array>;
  now?: Date;
  exportedAt?: Date;
};

const MAX_BUNDLE_BYTES = 100 * 1024 * 1024;

function extension(mimeType: PublicationAsset['mimeType']): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  return 'webp';
}

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
  if (recipe.version === 3 && recipe.kind === 'post') return;
  const expected = recipe.orderedAssetIds.map((id) => `asset:${id}`);
  const errors = getMarkdownImageReferenceErrors(recipe.markdown, expected, 'Publication recipe');
  for (const id of recipe.orderedAssetIds) {
    if (recipe.markdown.split(`](asset:${id})`).length !== 2) {
      errors.push(`Publication recipe must reference asset:${id} exactly once in canonical form.`);
    }
  }
  if (errors.length > 0) throw new Error(errors[0]);
}

async function downloadVerifiedAssets(
  recipe: BinancePublicationRecipe,
  downloadAsset: (asset: PublicationAsset) => Promise<Uint8Array>,
): Promise<Map<string, Uint8Array>> {
  const downloaded = new Map<string, Uint8Array>();
  for (const asset of recipe.assets) {
    const bytes = await downloadAsset(asset);
    if (
      bytes.byteLength !== asset.sizeBytes
      || await sha256Hex(bytes) !== asset.sha256
      || sniffImageMimeType(bytes) !== asset.mimeType
    ) {
      throw new Error('Publisher asset integrity verification failed.');
    }
    downloaded.set(asset.id, bytes);
  }
  return downloaded;
}

async function imageDimensions(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const metadata = await sharp(bytes, {
    failOn: 'error',
    limitInputPixels: 40_000_000,
  }).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Publication image dimensions are unavailable.');
  }
  return { width: metadata.width, height: metadata.height };
}

async function materializeV3BinanceBundle(input: {
  recipe: BinancePublicationRecipeV3;
  downloaded: Map<string, Uint8Array>;
  exportedAt?: Date;
}): Promise<{ bundleBytes: Uint8Array; manifest: Record<string, unknown> }> {
  const { recipe, downloaded } = input;
  const assetsById = new Map(recipe.assets.map((asset) => [asset.id, asset]));
  let content = recipe.kind === 'post' ? recipe.text : recipe.markdown;
  const images = [] as Array<Record<string, unknown> & { path: string; value: Uint8Array }>;

  for (const [order, assetId] of recipe.orderedAssetIds.entries()) {
    const asset = assetsById.get(assetId);
    const bytes = downloaded.get(assetId);
    if (!asset || !bytes) throw new Error('Publication body asset is missing.');
    const path = recipe.kind === 'post'
      ? `images/${String(order + 1).padStart(2, '0')}-post.${extension(asset.mimeType)}`
      : getSlideImagePath(order, asset.mimeType);
    if (recipe.kind === 'article') {
      content = content.replace(`](asset:${assetId})`, `](${path})`);
    }
    images.push({
      path,
      mimeType: asset.mimeType,
      bytes: bytes.byteLength,
      sha256: asset.sha256,
      slideId: asset.id,
      order,
      ...await imageDimensions(bytes),
      value: bytes,
    });
  }

  const contentPath = recipe.kind === 'post' ? 'post.txt' : 'article.md';
  const contentMime = recipe.kind === 'post' ? 'text/plain' : 'text/markdown';
  const contentBytes = new TextEncoder().encode(content);
  const manifest: Record<string, unknown> = {
    schemaVersion: 2,
    source: 'xarticle',
    platform: 'binance-square',
    kind: recipe.kind,
    articleId: recipe.articleId,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    ...(recipe.kind === 'article' ? { title: recipe.title } : {}),
    content: {
      path: contentPath,
      mimeType: contentMime,
      bytes: contentBytes.byteLength,
      sha256: await sha256Hex(contentBytes),
    },
    images: images.map(({ value: _value, ...image }) => image),
  };

  let coverBytes: Uint8Array | undefined;
  if (recipe.kind === 'article' && recipe.cover) {
    const source = downloaded.get(recipe.cover.assetId);
    if (!source) throw new Error('Publication cover asset is missing.');
    coverBytes = await cropBinanceCover({
      bytes: source,
      focalX: recipe.cover.focalX,
      focalY: recipe.cover.focalY,
    });
    manifest.cover = {
      path: 'images/cover.jpg',
      sourceSlideId: recipe.cover.assetId,
      mimeType: 'image/jpeg',
      bytes: coverBytes.byteLength,
      sha256: await sha256Hex(coverBytes),
      width: 1000,
      height: 400,
    };
  }

  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  const extractedBytes = manifestBytes.byteLength + contentBytes.byteLength
    + (coverBytes?.byteLength ?? 0)
    + images.reduce((total, image) => total + image.value.byteLength, 0);
  if (extractedBytes > MAX_BUNDLE_BYTES) throw new Error('Publication bundle is oversized.');
  const zip = new JSZip();
  zip.file('manifest.json', manifestBytes);
  zip.file(contentPath, contentBytes);
  if (coverBytes) zip.file('images/cover.jpg', coverBytes);
  for (const image of images) zip.file(image.path, image.value, { createFolders: false });
  const bundleBytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'UNIX',
  });
  if (bundleBytes.byteLength > MAX_BUNDLE_BYTES) throw new Error('Publication bundle is oversized.');
  return { bundleBytes, manifest };
}

export function materializePublicationBundle(
  input: MaterializeInput<PublicationRecipeV1 | BinanceSquarePublicationRecipeV2>,
): Promise<{ bundleBytes: Uint8Array; manifest: BinanceBundleManifest }>;
export function materializePublicationBundle(
  input: MaterializeInput,
): Promise<{ bundleBytes: Uint8Array; manifest: BinanceBundleManifest | Record<string, unknown> }>;
export async function materializePublicationBundle(
  input: MaterializeInput,
): Promise<{ bundleBytes: Uint8Array; manifest: BinanceBundleManifest | Record<string, unknown> }> {
  const recipe = requireBinancePublicationRecipe(input);
  assertCanonicalAssetReferences(recipe);
  const downloaded = await downloadVerifiedAssets(recipe, input.downloadAsset);
  if (recipe.version === 3) {
    return materializeV3BinanceBundle({ recipe, downloaded, exportedAt: input.exportedAt });
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
    const imageMetadata = await imageDimensions(bytes);
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
