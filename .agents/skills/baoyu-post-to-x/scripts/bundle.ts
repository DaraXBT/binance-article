import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';

export const X_BUNDLE_LIMITS = {
  maxArchiveBytes: 50 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxEntries: 6,
  maxImages: 4,
  maxImageBytes: 10 * 1024 * 1024,
  maxPostBytes: 100 * 1024,
  maxManifestBytes: 64 * 1024,
  maxPostCharacters: 280,
} as const;

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const IMAGE_PATH_PATTERN = /^images\/[0-9]{2}-post\.(?:jpg|jpeg|png|webp)$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const NO_FOLLOW_FLAG = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);

export type XBundleImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface XBundleFileMetadata {
  path: string;
  mimeType: string;
  bytes: number;
  sha256: string;
}

export interface XBundleImageMetadata extends XBundleFileMetadata {
  path: string;
  mimeType: XBundleImageMime;
  slideId: string;
  order: number;
  width: number;
  height: number;
}

export interface XBundleManifestV1 {
  schemaVersion: 1;
  source: 'xarticle';
  platform: 'x';
  kind: 'post';
  articleId: string;
  exportedAt: string;
  post: XBundleFileMetadata & { path: 'post.txt'; mimeType: 'text/plain' };
  images: readonly XBundleImageMetadata[];
}

export interface ValidatedXBundle {
  manifest: XBundleManifestV1;
  text: string;
  entries: Map<string, Uint8Array>;
}

export interface ExtractedXBundle extends ValidatedXBundle {
  bundleDir: string;
  postPath: string;
  imagePaths: string[];
}

export class XBundleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XBundleValidationError';
  }
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new XBundleValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string, maxLength = 10_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new XBundleValidationError(`${label} must be a non-empty string.`);
  }
  return value;
}

function expectInteger(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new XBundleValidationError(`${label} must be an integer between ${min} and ${max}.`);
  }
  return Number(value);
}

function expectIdentifier(value: unknown, label: string): string {
  const identifier = expectString(value, label, 200);
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new XBundleValidationError(`${label} is invalid.`);
  }
  return identifier;
}

export function validateBundlePath(value: string): string {
  if (!value || value.length > 240 || value.includes('\0') || value.includes('\\') || value.includes('%')) {
    throw new XBundleValidationError(`Unsafe bundle path: ${JSON.stringify(value)}.`);
  }
  if (value.startsWith('/') || value.startsWith('./') || /^[A-Za-z]:/.test(value) || value.includes('//')) {
    throw new XBundleValidationError(`Unsafe bundle path: ${value}.`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new XBundleValidationError(`Unsafe bundle path: ${value}.`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized.startsWith('../')) {
    throw new XBundleValidationError(`Unsafe bundle path: ${value}.`);
  }
  return value;
}

function parseFileMetadata(value: unknown, label: string): XBundleFileMetadata {
  const record = expectObject(value, label);
  const filePath = validateBundlePath(expectString(record.path, `${label}.path`, 240));
  const mimeType = expectString(record.mimeType, `${label}.mimeType`, 64);
  const bytes = expectInteger(record.bytes, `${label}.bytes`, 0, X_BUNDLE_LIMITS.maxTotalBytes);
  const sha256 = expectString(record.sha256, `${label}.sha256`, 64);
  if (!HASH_PATTERN.test(sha256)) throw new XBundleValidationError(`${label}.sha256 is invalid.`);
  return { path: filePath, mimeType, bytes, sha256 };
}

function parseImageMetadata(value: unknown, label: string): XBundleImageMetadata {
  const record = expectObject(value, label);
  const file = parseFileMetadata(record, label);
  if (!IMAGE_PATH_PATTERN.test(file.path)) {
    throw new XBundleValidationError(`${label}.path is not a supported X post image path.`);
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimeType)) {
    throw new XBundleValidationError(`${label}.mimeType is not supported.`);
  }
  if (file.bytes > X_BUNDLE_LIMITS.maxImageBytes) {
    throw new XBundleValidationError(`${file.path} exceeds the per-image size limit.`);
  }
  const order = expectInteger(record.order, `${label}.order`, 0, X_BUNDLE_LIMITS.maxImages - 1);
  const expectedPath = `images/${String(order + 1).padStart(2, '0')}-post.${file.mimeType === 'image/jpeg'
    ? 'jpg'
    : file.mimeType === 'image/png'
      ? 'png'
      : 'webp'}`;
  if (file.path !== expectedPath) {
    throw new XBundleValidationError(`${label}.path must match its image order and MIME type.`);
  }
  return {
    ...file,
    mimeType: file.mimeType as XBundleImageMime,
    slideId: expectIdentifier(record.slideId, `${label}.slideId`),
    order,
    width: expectInteger(record.width, `${label}.width`, 1, 100_000),
    height: expectInteger(record.height, `${label}.height`, 1, 100_000),
  };
}

export const XBundleManifestSchema = {
  parse(value: unknown): XBundleManifestV1 {
    const record = expectObject(value, 'manifest');
    if (record.schemaVersion !== 1) throw new XBundleValidationError('Unsupported bundle schemaVersion.');
    if (record.source !== 'xarticle') throw new XBundleValidationError('Unsupported bundle source.');
    if (record.platform !== 'x' || record.kind !== 'post') {
      throw new XBundleValidationError('Bundle must contain an X post.');
    }
    const articleId = expectIdentifier(record.articleId, 'articleId');
    const exportedAt = expectString(record.exportedAt, 'exportedAt', 64);
    if (!Number.isFinite(Date.parse(exportedAt))) throw new XBundleValidationError('exportedAt must be an ISO date.');
    const post = parseFileMetadata(record.post, 'post');
    if (post.path !== 'post.txt' || post.mimeType !== 'text/plain') {
      throw new XBundleValidationError('post must reference post.txt as text/plain.');
    }
    if (post.bytes > X_BUNDLE_LIMITS.maxPostBytes) {
      throw new XBundleValidationError('post.txt exceeds the text size limit.');
    }
    if (!Array.isArray(record.images)) throw new XBundleValidationError('images must be an array.');
    if (record.images.length > X_BUNDLE_LIMITS.maxImages) {
      throw new XBundleValidationError(`images may contain at most ${X_BUNDLE_LIMITS.maxImages} entries.`);
    }
    const images = record.images.map((image, index) => parseImageMetadata(image, `images[${index}]`));
    const paths = new Set<string>();
    const orders = new Set<number>();
    const slideIds = new Set<string>();
    for (const image of images) {
      if (paths.has(image.path)) throw new XBundleValidationError(`Duplicate image path: ${image.path}.`);
      if (orders.has(image.order)) throw new XBundleValidationError(`Duplicate image order: ${image.order}.`);
      if (slideIds.has(image.slideId)) throw new XBundleValidationError(`Duplicate slide image: ${image.slideId}.`);
      paths.add(image.path);
      orders.add(image.order);
      slideIds.add(image.slideId);
    }
    return {
      schemaVersion: 1,
      source: 'xarticle',
      platform: 'x',
      kind: 'post',
      articleId,
      exportedAt,
      post: { ...post, path: 'post.txt', mimeType: 'text/plain' },
      images,
    };
  },
};

export function validateImageSignature(bytes: Uint8Array, declaredMime: string): XBundleImageMime {
  const png = bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    .every((value, index) => bytes[index] === value);
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
  const actual = png ? 'image/png' : jpeg ? 'image/jpeg' : webp ? 'image/webp' : null;
  if (!actual) throw new XBundleValidationError('Image signature is not a supported PNG, JPEG, or WebP file.');
  if (actual !== declaredMime) {
    throw new XBundleValidationError(`Image MIME mismatch: declared ${declaredMime}, signature is ${actual}.`);
  }
  return actual;
}

function parseCentralDirectory(bytes: Uint8Array): Array<{ name: string; unixMode: number }> {
  // Locate and validate the End of Central Directory record from the end of
  // the archive. Scanning the whole archive for `PK\x01\x02` is unsafe because
  // those bytes can legitimately occur inside compressed image data.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumEocdBytes = 22;
  const maximumCommentBytes = 0xffff;
  if (bytes.length < minimumEocdBytes) {
    throw new XBundleValidationError('ZIP end-of-central-directory record was not found.');
  }
  const searchStart = Math.max(0, bytes.length - minimumEocdBytes - maximumCommentBytes);
  let eocdOffset = -1;
  for (let offset = bytes.length - minimumEocdBytes; offset >= searchStart; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + minimumEocdBytes + commentLength === bytes.length) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new XBundleValidationError('ZIP end-of-central-directory record was not found.');

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new XBundleValidationError('Multi-disk ZIP archives are not supported.');
  }
  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new XBundleValidationError('ZIP64 archives are not supported.');
  }
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (
    centralDirectoryOffset < 0 ||
    centralDirectoryEnd < centralDirectoryOffset ||
    centralDirectoryEnd > eocdOffset
  ) {
    throw new XBundleValidationError('Malformed ZIP central directory bounds.');
  }

  const entries: Array<{ name: string; unixMode: number }> = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralDirectoryEnd || view.getUint32(offset, true) !== 0x02014b50) {
      throw new XBundleValidationError('Malformed ZIP central directory.');
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > centralDirectoryEnd) throw new XBundleValidationError('Malformed ZIP central directory.');
    let name: string;
    try {
      name = new TextDecoder('utf-8', { fatal: true })
        .decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    } catch {
      throw new XBundleValidationError('ZIP entry name is not valid UTF-8.');
    }
    entries.push({ name, unixMode: externalAttributes >>> 16 });
    offset = end;
  }
  if (offset !== centralDirectoryEnd) throw new XBundleValidationError('Malformed ZIP central directory.');
  if (entries.length === 0) throw new XBundleValidationError('ZIP central directory was not found.');
  return entries;
}

function assertSafeCentralDirectory(bytes: Uint8Array): void {
  const entries = parseCentralDirectory(bytes);
  if (entries.length > X_BUNDLE_LIMITS.maxEntries + 1) {
    throw new XBundleValidationError('Bundle contains too many entries.');
  }
  for (const entry of entries) {
    const fileType = entry.unixMode & 0o170000;
    if (fileType === 0o120000) throw new XBundleValidationError(`Symbolic links are not allowed: ${entry.name}.`);
    if (entry.name.endsWith('/')) {
      if (entry.name !== 'images/') throw new XBundleValidationError(`Unexpected ZIP directory: ${entry.name}.`);
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
    if (failure || file.name.endsWith('/')) return;
    try {
      discovered += 1;
      if (discovered > X_BUNDLE_LIMITS.maxEntries) throw new XBundleValidationError('Bundle contains too many entries.');
      const safeName = validateBundlePath(file.name);
      if (entries.has(safeName)) throw new XBundleValidationError(`Duplicate bundle entry: ${safeName}.`);
      const entryLimit = safeName === 'manifest.json'
        ? X_BUNDLE_LIMITS.maxManifestBytes
        : safeName === 'post.txt'
          ? X_BUNDLE_LIMITS.maxPostBytes
          : X_BUNDLE_LIMITS.maxImageBytes;
      if (file.originalSize !== undefined && file.originalSize > entryLimit) {
        throw new XBundleValidationError(`${safeName} exceeds its extracted size limit.`);
      }
      const chunks: Uint8Array[] = [];
      let entryBytes = 0;
      file.ondata = (error, chunk, final) => {
        if (error) { failure = error; return; }
        entryBytes += chunk.byteLength;
        totalBytes += chunk.byteLength;
        if (entryBytes > entryLimit || totalBytes > X_BUNDLE_LIMITS.maxTotalBytes) {
          failure = new XBundleValidationError('Bundle exceeds extracted size limits.');
          file.terminate();
          return;
        }
        chunks.push(chunk);
        if (final) {
          const joined = new Uint8Array(entryBytes);
          let position = 0;
          for (const part of chunks) { joined.set(part, position); position += part.byteLength; }
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

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function verifyFile(entries: Map<string, Uint8Array>, metadata: XBundleFileMetadata): Uint8Array {
  const bytes = entries.get(metadata.path);
  if (!bytes) throw new XBundleValidationError(`Required entry is missing: ${metadata.path}.`);
  if (bytes.byteLength !== metadata.bytes) throw new XBundleValidationError(`Byte count mismatch for ${metadata.path}.`);
  if (sha256Hex(bytes) !== metadata.sha256) throw new XBundleValidationError(`SHA-256 mismatch for ${metadata.path}.`);
  return bytes;
}

function validateEntrySet(entryNames: readonly string[], manifest: XBundleManifestV1): void {
  const expected = new Set(['manifest.json', manifest.post.path, ...manifest.images.map((image) => image.path)]);
  const actual = new Set<string>();
  for (const entry of entryNames) {
    validateBundlePath(entry);
    if (actual.has(entry)) throw new XBundleValidationError(`Duplicate bundle entry: ${entry}.`);
    actual.add(entry);
  }
  for (const entry of actual) {
    if (!expected.has(entry)) throw new XBundleValidationError(`Unexpected or unlisted bundle entry: ${entry}.`);
  }
  for (const entry of expected) {
    if (!actual.has(entry)) throw new XBundleValidationError(`Required bundle entry is missing: ${entry}.`);
  }
}

async function readRegularFileBounded(filePath: string, maxBytes: number, label: string): Promise<Uint8Array> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | NO_FOLLOW_FLAG);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new XBundleValidationError(`${label} is not a regular file.`);
    if (stat.size > maxBytes) throw new XBundleValidationError(`${label} exceeds its size limit.`);
    const output = new Uint8Array(maxBytes + 1);
    let offset = 0;
    while (offset < output.byteLength) {
      const result = await handle.read(output, offset, output.byteLength - offset, null);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset > maxBytes || offset !== stat.size) {
      throw new XBundleValidationError(`${label} changed or exceeded its size limit while being read.`);
    }
    return output.slice(0, offset);
  } catch (error) {
    if (error instanceof XBundleValidationError) throw error;
    throw new XBundleValidationError(`${label} could not be read safely.`);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function validateXPostBundleArchive(bundlePath: string): Promise<ValidatedXBundle> {
  const linkStat = await fs.lstat(bundlePath).catch(() => null);
  if (!linkStat?.isFile() || linkStat.isSymbolicLink()) {
    throw new XBundleValidationError('X post bundle ZIP was not found.');
  }
  const archive = await readRegularFileBounded(bundlePath, X_BUNDLE_LIMITS.maxArchiveBytes, 'X post bundle ZIP');
  const entries = unzipBounded(archive);
  const manifestBytes = entries.get('manifest.json');
  if (!manifestBytes || manifestBytes.byteLength > X_BUNDLE_LIMITS.maxManifestBytes) {
    throw new XBundleValidationError('manifest.json is missing or oversized.');
  }
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  } catch {
    throw new XBundleValidationError('manifest.json is not valid UTF-8 JSON.');
  }
  const manifest = XBundleManifestSchema.parse(rawManifest);
  validateEntrySet([...entries.keys()], manifest);
  const postBytes = verifyFile(entries, manifest.post);
  for (const image of manifest.images) validateImageSignature(verifyFile(entries, image), image.mimeType);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(postBytes);
  } catch {
    throw new XBundleValidationError('post.txt is not valid UTF-8.');
  }
  if ([...text].length > X_BUNDLE_LIMITS.maxPostCharacters) {
    throw new XBundleValidationError('post.txt exceeds 280 characters, the X post limit.');
  }
  if (!text.trim() && manifest.images.length === 0) {
    throw new XBundleValidationError('The X post bundle has no text or images.');
  }
  return { manifest, text, entries };
}

export async function extractValidatedXPostBundle(
  bundlePath: string,
  options: { outputRoot?: string } = {},
): Promise<ExtractedXBundle> {
  const validated = await validateXPostBundleArchive(bundlePath);
  const parent = options.outputRoot ?? path.join(os.tmpdir(), 'baoyu-post-to-x');
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const bundleDir = await fs.mkdtemp(path.join(parent, 'bundle-'));
  await fs.chmod(bundleDir, 0o700).catch(() => undefined);
  try {
    for (const [relativePath, bytes] of validated.entries) {
      const destination = path.join(bundleDir, ...relativePath.split('/'));
      const resolved = path.resolve(destination);
      if (!resolved.startsWith(`${path.resolve(bundleDir)}${path.sep}`)) {
        throw new XBundleValidationError(`Unsafe extraction path: ${relativePath}.`);
      }
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await fs.writeFile(destination, bytes, { mode: 0o600, flag: 'wx' });
    }
    return {
      ...validated,
      bundleDir,
      postPath: path.join(bundleDir, validated.manifest.post.path),
      imagePaths: [...validated.manifest.images]
        .sort((left, right) => left.order - right.order)
        .map((image) => path.join(bundleDir, image.path)),
    };
  } catch (error) {
    await fs.rm(bundleDir, { recursive: true, force: true });
    throw error;
  }
}
