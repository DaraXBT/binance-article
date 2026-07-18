import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';

export const BUNDLE_LIMITS = {
  maxArchiveBytes: 100 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxEntries: 32,
  maxImages: 20,
  maxImageBytes: 10 * 1024 * 1024,
  maxMarkdownBytes: 1024 * 1024,
  maxManifestBytes: 256 * 1024,
  maxArticleCharacters: 100_000,
} as const;

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const IMAGE_PATH_PATTERN = /^images\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpg|jpeg|png|webp)$/;
const BINANCE_HOST_PATTERN = /(^|\.)binance\.com$/i;

export type BundleImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface BundleFileMetadata {
  path: string;
  mimeType: string;
  bytes: number;
  sha256: string;
}

export interface BundleImageMetadata extends BundleFileMetadata {
  slideId: string;
  order: number;
  mimeType: BundleImageMime;
  width: number;
  height: number;
}

export interface BundleManifestV1 {
  schemaVersion: 1;
  source: 'xarticle';
  articleId: string;
  exportedAt: string;
  title: string;
  markdown: BundleFileMetadata & { path: 'article.md'; mimeType: 'text/markdown' };
  cover: Omit<BundleImageMetadata, 'slideId' | 'order'> & {
    path: 'images/cover.jpg';
    sourceSlideId: string;
    mimeType: 'image/jpeg';
    width: 1000;
    height: 400;
  };
  images: readonly BundleImageMetadata[];
}

export interface ValidatedBundle {
  manifest: BundleManifestV1;
  markdown: string;
  entries: Map<string, Uint8Array>;
}

export interface ExtractedBundle extends ValidatedBundle {
  bundleDir: string;
  markdownPath: string;
  coverPath: string;
  imagePaths: string[];
}

export class BundleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleValidationError';
  }
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BundleValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string, maxLength = 10_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new BundleValidationError(`${label} must be a non-empty string.`);
  }
  return value;
}

function expectInteger(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new BundleValidationError(`${label} must be an integer between ${min} and ${max}.`);
  }
  return Number(value);
}

function parseFileMetadata(value: unknown, label: string): BundleFileMetadata {
  const record = expectObject(value, label);
  const filePath = validateBundlePath(expectString(record.path, `${label}.path`, 240));
  const mimeType = expectString(record.mimeType, `${label}.mimeType`, 64);
  const bytes = expectInteger(record.bytes, `${label}.bytes`, 0, BUNDLE_LIMITS.maxTotalBytes);
  const sha256 = expectString(record.sha256, `${label}.sha256`, 64);
  if (!HASH_PATTERN.test(sha256)) throw new BundleValidationError(`${label}.sha256 is invalid.`);
  return { path: filePath, mimeType, bytes, sha256 };
}

function parseImageMetadata(value: unknown, label: string): BundleImageMetadata {
  const record = expectObject(value, label);
  const file = parseFileMetadata(record, label);
  if (!IMAGE_PATH_PATTERN.test(file.path)) throw new BundleValidationError(`${label}.path is not an image path.`);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimeType)) {
    throw new BundleValidationError(`${label}.mimeType is not supported.`);
  }
  return {
    ...file,
    mimeType: file.mimeType as BundleImageMime,
    slideId: expectString(record.slideId, `${label}.slideId`, 200),
    order: expectInteger(record.order, `${label}.order`, 0, BUNDLE_LIMITS.maxImages - 1),
    width: expectInteger(record.width, `${label}.width`, 1, 100_000),
    height: expectInteger(record.height, `${label}.height`, 1, 100_000),
  };
}

export const BundleManifestSchema = {
  parse(value: unknown): BundleManifestV1 {
    const record = expectObject(value, 'manifest');
    if (record.schemaVersion !== 1) throw new BundleValidationError('Unsupported bundle schemaVersion.');
    if (record.source !== 'xarticle') throw new BundleValidationError('Unsupported bundle source.');
    const articleId = expectString(record.articleId, 'articleId', 200);
    const exportedAt = expectString(record.exportedAt, 'exportedAt', 64);
    if (!Number.isFinite(Date.parse(exportedAt))) throw new BundleValidationError('exportedAt must be an ISO date.');
    const title = expectString(record.title, 'title', 200).trim();

    const markdown = parseFileMetadata(record.markdown, 'markdown');
    if (markdown.path !== 'article.md' || markdown.mimeType !== 'text/markdown') {
      throw new BundleValidationError('markdown must reference article.md as text/markdown.');
    }
    if (markdown.bytes > BUNDLE_LIMITS.maxMarkdownBytes) {
      throw new BundleValidationError('article.md exceeds the Markdown size limit.');
    }

    const coverRecord = expectObject(record.cover, 'cover');
    const coverFile = parseFileMetadata(coverRecord, 'cover');
    if (coverFile.path !== 'images/cover.jpg' || coverFile.mimeType !== 'image/jpeg') {
      throw new BundleValidationError('cover must reference images/cover.jpg as image/jpeg.');
    }
    const coverWidth = expectInteger(coverRecord.width, 'cover.width', 1, 100_000);
    const coverHeight = expectInteger(coverRecord.height, 'cover.height', 1, 100_000);
    if (coverWidth !== 1000 || coverHeight !== 400) {
      throw new BundleValidationError('cover must be 1000x400 (5:2).');
    }
    const sourceSlideId = expectString(coverRecord.sourceSlideId, 'cover.sourceSlideId', 200);

    if (!Array.isArray(record.images)) throw new BundleValidationError('images must be an array.');
    if (record.images.length > BUNDLE_LIMITS.maxImages) {
      throw new BundleValidationError(`images may contain at most ${BUNDLE_LIMITS.maxImages} entries.`);
    }
    const images = record.images.map((image, index) => parseImageMetadata(image, `images[${index}]`));
    const paths = new Set<string>();
    const orders = new Set<number>();
    for (const image of images) {
      if (paths.has(image.path) || image.path === coverFile.path) {
        throw new BundleValidationError(`Duplicate image path: ${image.path}`);
      }
      if (orders.has(image.order)) throw new BundleValidationError(`Duplicate image order: ${image.order}`);
      if (image.bytes > BUNDLE_LIMITS.maxImageBytes) {
        throw new BundleValidationError(`${image.path} exceeds the per-image size limit.`);
      }
      paths.add(image.path);
      orders.add(image.order);
    }

    return {
      schemaVersion: 1,
      source: 'xarticle',
      articleId,
      exportedAt,
      title,
      markdown: { ...markdown, path: 'article.md', mimeType: 'text/markdown' },
      cover: {
        ...coverFile,
        path: 'images/cover.jpg',
        mimeType: 'image/jpeg',
        sourceSlideId,
        width: 1000,
        height: 400,
      },
      images,
    };
  },
};

export function validateBundlePath(value: string): string {
  if (!value || value.length > 240 || value.includes('\0') || value.includes('\\') || value.includes('%')) {
    throw new BundleValidationError(`Unsafe bundle path: ${JSON.stringify(value)}.`);
  }
  if (value.startsWith('/') || value.startsWith('./') || /^[A-Za-z]:/.test(value) || value.includes('//')) {
    throw new BundleValidationError(`Unsafe bundle path: ${value}.`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new BundleValidationError(`Unsafe bundle path: ${value}.`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized.startsWith('../')) {
    throw new BundleValidationError(`Unsafe bundle path: ${value}.`);
  }
  return value;
}

export function validateImageSignature(bytes: Uint8Array, declaredMime: string): BundleImageMime {
  const png = bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    .every((value, index) => bytes[index] === value);
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
  const actual = png ? 'image/png' : jpeg ? 'image/jpeg' : webp ? 'image/webp' : null;
  if (!actual) throw new BundleValidationError('Image signature is not a supported PNG, JPEG, or WebP file.');
  if (actual !== declaredMime) {
    throw new BundleValidationError(`Image MIME mismatch: declared ${declaredMime}, signature is ${actual}.`);
  }
  return actual;
}

export function validateBundleEntrySet(entryNames: readonly string[], manifest: BundleManifestV1): void {
  if (entryNames.length > BUNDLE_LIMITS.maxEntries) {
    throw new BundleValidationError(`Bundle has more than ${BUNDLE_LIMITS.maxEntries} entries.`);
  }
  const expected = new Set([
    'manifest.json',
    manifest.markdown.path,
    manifest.cover.path,
    ...manifest.images.map((image) => image.path),
  ]);
  const actual = new Set<string>();
  for (const entry of entryNames) {
    validateBundlePath(entry);
    if (actual.has(entry)) throw new BundleValidationError(`Duplicate bundle entry: ${entry}.`);
    actual.add(entry);
  }
  for (const entry of actual) {
    if (!expected.has(entry)) throw new BundleValidationError(`Unexpected or unlisted bundle entry: ${entry}.`);
  }
  for (const entry of expected) {
    if (!actual.has(entry)) throw new BundleValidationError(`Required bundle entry is missing: ${entry}.`);
  }
}

function parseCentralDirectory(bytes: Uint8Array): Array<{ name: string; unixMode: number }> {
  const entries: Array<{ name: string; unixMode: number }> = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) throw new BundleValidationError('Malformed ZIP central directory.');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({ name, unixMode: externalAttributes >>> 16 });
    offset = end - 1;
  }
  if (entries.length === 0) throw new BundleValidationError('ZIP central directory was not found.');
  return entries;
}

function assertSafeCentralDirectory(bytes: Uint8Array): void {
  const entries = parseCentralDirectory(bytes);
  if (entries.length > BUNDLE_LIMITS.maxEntries) {
    throw new BundleValidationError(`Bundle has more than ${BUNDLE_LIMITS.maxEntries} entries.`);
  }
  for (const entry of entries) {
    const fileType = entry.unixMode & 0o170000;
    if (fileType === 0o120000) throw new BundleValidationError(`Symbolic links are not allowed: ${entry.name}.`);
    if (entry.name.endsWith('/')) {
      if (entry.name !== 'images/') throw new BundleValidationError(`Unexpected ZIP directory: ${entry.name}.`);
      continue;
    }
    validateBundlePath(entry.name);
  }
}

function unzipBounded(archive: Uint8Array): Map<string, Uint8Array> {
  assertSafeCentralDirectory(archive);
  const entries = new Map<string, Uint8Array>();
  let totalBytes = 0;
  let discovered = 0;
  let failure: Error | null = null;
  const unzipper = new Unzip((file) => {
    if (failure) return;
    if (file.name.endsWith('/')) return;
    try {
      discovered += 1;
      if (discovered > BUNDLE_LIMITS.maxEntries) throw new BundleValidationError('Bundle contains too many entries.');
      const safeName = validateBundlePath(file.name);
      if (entries.has(safeName)) throw new BundleValidationError(`Duplicate bundle entry: ${safeName}.`);
      const declaredLimit = safeName === 'manifest.json'
        ? BUNDLE_LIMITS.maxManifestBytes
        : safeName === 'article.md'
          ? BUNDLE_LIMITS.maxMarkdownBytes
          : BUNDLE_LIMITS.maxImageBytes;
      if (file.originalSize !== undefined && file.originalSize > declaredLimit) {
        throw new BundleValidationError(`${safeName} exceeds its extracted size limit.`);
      }
      const chunks: Uint8Array[] = [];
      let entryBytes = 0;
      file.ondata = (error, chunk, final) => {
        if (error) { failure = error; return; }
        entryBytes += chunk.byteLength;
        totalBytes += chunk.byteLength;
        if (entryBytes > declaredLimit || totalBytes > BUNDLE_LIMITS.maxTotalBytes) {
          failure = new BundleValidationError('Bundle exceeds extracted size limits.');
          file.terminate();
          return;
        }
        chunks.push(chunk);
        if (final) {
          const joined = new Uint8Array(entryBytes);
          let offset = 0;
          for (const part of chunks) { joined.set(part, offset); offset += part.byteLength; }
          entries.set(safeName, joined);
        }
      };
      file.start();
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
  });
  unzipper.register(UnzipInflate);
  unzipper.register(UnzipPassThrough);
  try {
    unzipper.push(archive, true);
  } catch (error) {
    failure ??= error instanceof Error ? error : new Error(String(error));
  }
  if (failure) throw failure;
  return entries;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256Text(value: string): string {
  return sha256Hex(new TextEncoder().encode(value));
}

function verifyFile(entries: Map<string, Uint8Array>, metadata: BundleFileMetadata): Uint8Array {
  const bytes = entries.get(metadata.path);
  if (!bytes) throw new BundleValidationError(`Required entry is missing: ${metadata.path}.`);
  if (bytes.byteLength !== metadata.bytes) throw new BundleValidationError(`Byte count mismatch for ${metadata.path}.`);
  if (sha256Hex(bytes) !== metadata.sha256) throw new BundleValidationError(`SHA-256 mismatch for ${metadata.path}.`);
  return bytes;
}

export async function validateBundleArchive(bundlePath: string): Promise<ValidatedBundle> {
  const stat = await fs.stat(bundlePath).catch(() => null);
  if (!stat?.isFile()) throw new BundleValidationError('Bundle ZIP was not found.');
  if (stat.size <= 0 || stat.size > BUNDLE_LIMITS.maxArchiveBytes) {
    throw new BundleValidationError('Bundle ZIP exceeds the compressed size limit.');
  }
  const archive = new Uint8Array(await fs.readFile(bundlePath));
  const entries = unzipBounded(archive);
  const manifestBytes = entries.get('manifest.json');
  if (!manifestBytes) throw new BundleValidationError('manifest.json is missing.');
  if (manifestBytes.byteLength > BUNDLE_LIMITS.maxManifestBytes) {
    throw new BundleValidationError('manifest.json exceeds the size limit.');
  }

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  } catch {
    throw new BundleValidationError('manifest.json is not valid UTF-8 JSON.');
  }
  const manifest = BundleManifestSchema.parse(rawManifest);
  validateBundleEntrySet([...entries.keys()], manifest);

  const markdownBytes = verifyFile(entries, manifest.markdown);
  const coverBytes = verifyFile(entries, manifest.cover);
  validateImageSignature(coverBytes, manifest.cover.mimeType);
  for (const image of manifest.images) validateImageSignature(verifyFile(entries, image), image.mimeType);

  let markdown: string;
  try {
    markdown = new TextDecoder('utf-8', { fatal: true }).decode(markdownBytes);
  } catch {
    throw new BundleValidationError('article.md is not valid UTF-8.');
  }
  if (!markdown.trim()) throw new BundleValidationError('article.md is empty.');
  if ([...markdown].length > BUNDLE_LIMITS.maxArticleCharacters) {
    throw new BundleValidationError('article.md exceeds Binance\'s 100,000-character limit.');
  }
  return { manifest, markdown, entries };
}

async function readExtractedEntries(root: string): Promise<Map<string, Uint8Array>> {
  const entries = new Map<string, Uint8Array>();
  const resolvedRoot = path.resolve(root);
  async function visit(directory: string, relativeDirectory = ''): Promise<void> {
    const children = await fs.readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name;
      const safePath = validateBundlePath(relativePath);
      const absolutePath = path.resolve(directory, child.name);
      if (!absolutePath.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new BundleValidationError(`Unsafe extracted path: ${relativePath}.`);
      }
      const stat = await fs.lstat(absolutePath);
      if (stat.isSymbolicLink()) throw new BundleValidationError(`Symbolic links are not allowed: ${relativePath}.`);
      if (stat.isDirectory()) {
        if (relativePath !== 'images') throw new BundleValidationError(`Unexpected extracted directory: ${relativePath}.`);
        await visit(absolutePath, relativePath);
      } else if (stat.isFile()) {
        entries.set(safePath, new Uint8Array(await fs.readFile(absolutePath)));
      } else {
        throw new BundleValidationError(`Unsupported extracted entry: ${relativePath}.`);
      }
    }
  }
  await visit(resolvedRoot);
  return entries;
}

export async function validateExtractedBundle(bundleDir: string): Promise<ValidatedBundle> {
  const stat = await fs.lstat(bundleDir).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new BundleValidationError('Extracted bundle directory is missing or unsafe.');
  const entries = await readExtractedEntries(bundleDir);
  const manifestBytes = entries.get('manifest.json');
  if (!manifestBytes || manifestBytes.byteLength > BUNDLE_LIMITS.maxManifestBytes) {
    throw new BundleValidationError('Extracted manifest.json is missing or oversized.');
  }
  let manifest: BundleManifestV1;
  try {
    manifest = BundleManifestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)));
  } catch (error) {
    if (error instanceof BundleValidationError) throw error;
    throw new BundleValidationError('Extracted manifest.json is invalid.');
  }
  validateBundleEntrySet([...entries.keys()], manifest);
  const markdownBytes = verifyFile(entries, manifest.markdown);
  validateImageSignature(verifyFile(entries, manifest.cover), manifest.cover.mimeType);
  for (const image of manifest.images) validateImageSignature(verifyFile(entries, image), image.mimeType);
  const markdown = new TextDecoder('utf-8', { fatal: true }).decode(markdownBytes);
  if (!markdown.trim() || [...markdown].length > BUNDLE_LIMITS.maxArticleCharacters) {
    throw new BundleValidationError('Extracted article.md is empty or exceeds Binance limits.');
  }
  return { manifest, markdown, entries };
}

export async function extractValidatedBundle(
  bundlePath: string,
  options: { outputRoot?: string } = {},
): Promise<ExtractedBundle> {
  const validated = await validateBundleArchive(bundlePath);
  const parent = options.outputRoot ?? path.join(os.tmpdir(), 'baoyu-binance-square');
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const bundleDir = await fs.mkdtemp(path.join(parent, 'bundle-'));
  await fs.chmod(bundleDir, 0o700).catch(() => undefined);
  try {
    for (const [relativePath, bytes] of validated.entries) {
      const destination = path.join(bundleDir, ...relativePath.split('/'));
      const resolved = path.resolve(destination);
      if (!resolved.startsWith(`${path.resolve(bundleDir)}${path.sep}`)) {
        throw new BundleValidationError(`Unsafe extraction path: ${relativePath}.`);
      }
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await fs.writeFile(destination, bytes, { mode: 0o600, flag: 'wx' });
    }
    return {
      ...validated,
      bundleDir,
      markdownPath: path.join(bundleDir, validated.manifest.markdown.path),
      coverPath: path.join(bundleDir, validated.manifest.cover.path),
      imagePaths: [...validated.manifest.images]
        .sort((a, b) => a.order - b.order)
        .map((image) => path.join(bundleDir, image.path)),
    };
  } catch (error) {
    await fs.rm(bundleDir, { recursive: true, force: true });
    throw error;
  }
}

export function isBinanceEditorUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && BINANCE_HOST_PATTERN.test(url.hostname) &&
      url.pathname.includes('/square/') && /creator|article|editor/i.test(url.pathname);
  } catch {
    return false;
  }
}
