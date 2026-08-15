import JSZip from 'jszip';
import sharp from 'sharp';

import {
  X_POST_MAX_CHARACTERS,
  X_POST_MAX_IMAGES,
  validatePublicationRecipe,
  type PublicationRecipeV3,
  type XPublicationRecipeV2,
} from '../../server/domain/publication-recipe';
import {
  getMarkdownImageReferenceErrors,
} from '../../.agents/skills/baoyu-post-to-binance-square/scripts/markdown-image-references';

import { sha256Hex, sniffImageMimeType } from './asset-download';

const MAX_X_POST_BYTES = 100 * 1024;
const MAX_X_BUNDLE_BYTES = 50 * 1024 * 1024;
const MAX_X_MANIFEST_BYTES = 64 * 1024;

type XPublicationAsset = XPublicationRecipeV2['assets'][number];
type XImageMime = XPublicationAsset['mimeType'];
type XPublicationRecipeV3 = Extract<PublicationRecipeV3, { target: 'x' }>;

function imagePath(order: number, mimeType: XImageMime): string {
  const extension = mimeType === 'image/jpeg'
    ? 'jpg'
    : mimeType === 'image/png'
      ? 'png'
      : 'webp';
  return `images/${String(order + 1).padStart(2, '0')}-post.${extension}`;
}

function bodyImagePath(order: number, mimeType: XImageMime): string {
  const extension = mimeType === 'image/jpeg'
    ? 'jpg'
    : mimeType === 'image/png'
      ? 'png'
      : 'webp';
  return `images/${String(order + 1).padStart(2, '0')}-body.${extension}`;
}

async function dimensions(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const metadata = await sharp(bytes, {
    failOn: 'error',
    limitInputPixels: 40_000_000,
  }).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('X publication image dimensions are unavailable.');
  }
  return { width: metadata.width, height: metadata.height };
}

async function materializeXPublicationBundleV3(input: {
  recipe: XPublicationRecipeV3;
  downloadAsset: (asset: XPublicationAsset) => Promise<Uint8Array>;
  exportedAt?: Date;
}): Promise<{ bundleBytes: Uint8Array; manifest: unknown }> {
  const { recipe } = input;
  if (recipe.kind === 'article') {
    const errors = getMarkdownImageReferenceErrors(
      recipe.markdown,
      recipe.orderedAssetIds.map((id) => `asset:${id}`),
      'X Article Markdown',
    );
    if (errors[0]) throw new Error(errors[0]);
  }
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
  let content = recipe.kind === 'post' ? recipe.text : recipe.markdown;
  const images = [] as Array<{
    path: string;
    mimeType: XImageMime;
    bytes: number;
    sha256: string;
    slideId: string;
    order: number;
    width: number;
    height: number;
    value: Uint8Array;
  }>;
  for (const [order, assetId] of recipe.orderedAssetIds.entries()) {
    const asset = assetsById.get(assetId);
    const bytes = downloaded.get(assetId);
    if (!asset || !bytes) throw new Error('X publication image is missing.');
    const path = recipe.kind === 'post'
      ? imagePath(order, asset.mimeType)
      : bodyImagePath(order, asset.mimeType);
    if (recipe.kind === 'article') {
      const reference = `](asset:${assetId})`;
      if (content.split(reference).length !== 2) {
        throw new Error(`X article must reference asset:${assetId} exactly once.`);
      }
      content = content.replace(reference, `](${path})`);
    }
    images.push({
      path,
      mimeType: asset.mimeType,
      bytes: bytes.byteLength,
      sha256: asset.sha256,
      slideId: asset.id,
      order,
      ...await dimensions(bytes),
      value: bytes,
    });
  }

  const contentPath = recipe.kind === 'post' ? 'post.txt' : 'article.md';
  const contentMime = recipe.kind === 'post' ? 'text/plain' : 'text/markdown';
  const contentBytes = new TextEncoder().encode(content);
  const manifest: Record<string, unknown> = {
    schemaVersion: 2,
    source: 'xarticle',
    platform: 'x',
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

  let coverEntry: { path: string; value: Uint8Array } | undefined;
  if (recipe.kind === 'article' && recipe.cover) {
    const asset = assetsById.get(recipe.cover.assetId);
    const bytes = downloaded.get(recipe.cover.assetId);
    if (!asset || !bytes) throw new Error('X article cover is missing.');
    const path = `images/cover.${asset.mimeType === 'image/jpeg' ? 'jpg' : asset.mimeType === 'image/png' ? 'png' : 'webp'}`;
    manifest.cover = {
      path,
      sourceSlideId: asset.id,
      mimeType: asset.mimeType,
      bytes: bytes.byteLength,
      sha256: asset.sha256,
      ...await dimensions(bytes),
    };
    coverEntry = { path, value: bytes };
  }

  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  if (new TextEncoder().encode(manifestText).byteLength > MAX_X_MANIFEST_BYTES) {
    throw new Error('X publication manifest exceeds the supported limit.');
  }
  const zip = new JSZip();
  zip.file('manifest.json', manifestText);
  zip.file(contentPath, contentBytes);
  if (coverEntry) zip.file(coverEntry.path, coverEntry.value, { createFolders: false });
  for (const image of images) zip.file(image.path, image.value, { createFolders: false });
  const bundleBytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'UNIX',
  });
  if (bundleBytes.byteLength > MAX_X_BUNDLE_BYTES) {
    throw new Error('X publication bundle exceeds the supported limit.');
  }
  return { bundleBytes, manifest };
}

export async function materializeXPublicationBundle(input: {
  recipe: unknown;
  expectedRevision: number;
  downloadAsset: (asset: XPublicationAsset) => Promise<Uint8Array>;
  now?: Date;
  exportedAt?: Date;
}): Promise<{ bundleBytes: Uint8Array; manifest: unknown }> {
  const recipe = validatePublicationRecipe(input.recipe, {
    expectedRevision: input.expectedRevision,
    now: input.now,
  });
  if (recipe.version === 1 || recipe.target !== 'x') {
    throw new Error('The publication recipe target does not match X.');
  }
  if (recipe.version === 3) {
    return materializeXPublicationBundleV3({
      recipe,
      downloadAsset: input.downloadAsset,
      exportedAt: input.exportedAt,
    });
  }
  const text = recipe.text;
  const textBytes = new TextEncoder().encode(text);
  if (!text && recipe.orderedAssetIds.length === 0) {
    throw new Error('X publication requires post text or at least one image.');
  }
  if ([...text].length > X_POST_MAX_CHARACTERS || textBytes.byteLength > MAX_X_POST_BYTES) {
    throw new Error('X publication text exceeds the supported limit.');
  }
  if (recipe.orderedAssetIds.length > X_POST_MAX_IMAGES) {
    throw new Error(`X publication supports at most ${X_POST_MAX_IMAGES} images.`);
  }

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
  const images = [];
  for (const [order, assetId] of recipe.orderedAssetIds.entries()) {
    const asset = assetsById.get(assetId);
    const bytes = downloaded.get(assetId);
    if (!asset || !bytes) throw new Error('X publication image is missing.');
    const metadata = await sharp(bytes, {
      failOn: 'error',
      limitInputPixels: 40_000_000,
    }).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('X publication image dimensions are unavailable.');
    }
    images.push({
      path: imagePath(order, asset.mimeType),
      mimeType: asset.mimeType,
      bytes: asset.sizeBytes,
      sha256: asset.sha256,
      slideId: asset.id,
      order,
      width: metadata.width,
      height: metadata.height,
      value: bytes,
    });
  }

  const manifest = {
    schemaVersion: 1,
    source: 'xarticle',
    platform: 'x',
    kind: 'post',
    articleId: recipe.articleId,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    post: {
      path: 'post.txt',
      mimeType: 'text/plain',
      bytes: textBytes.byteLength,
      sha256: await sha256Hex(textBytes),
    },
    images: images.map(({ value: _value, ...image }) => image),
  } as const;
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  if (new TextEncoder().encode(manifestText).byteLength > MAX_X_MANIFEST_BYTES) {
    throw new Error('X publication manifest exceeds the supported limit.');
  }

  const zip = new JSZip();
  zip.file('manifest.json', manifestText);
  zip.file('post.txt', textBytes);
  for (const image of images) zip.file(image.path, image.value, { createFolders: false });
  const bundleBytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'UNIX',
  });
  if (bundleBytes.byteLength > MAX_X_BUNDLE_BYTES) {
    throw new Error('X publication bundle exceeds the supported limit.');
  }
  return { bundleBytes, manifest };
}
