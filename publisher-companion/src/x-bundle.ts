import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import { z } from 'zod';

import {
  X_POST_MAX_CHARACTERS,
  X_POST_MAX_IMAGES,
} from '../../server/domain/publication-recipe';

import { sha256Hex, sniffImageMimeType } from './asset-download';

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 50 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_POST_BYTES = 100 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SAFE_IMAGE_PATH = /^images\/[0-9]{2}-post\.(?:jpg|jpeg|png|webp)$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

const FileSchema = z.object({
  path: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(64),
  bytes: z.number().int().min(0).max(MAX_EXTRACTED_BYTES),
  sha256: z.string().regex(HASH_PATTERN),
}).strict();

const ImageSchema = FileSchema.extend({
  path: z.string().regex(SAFE_IMAGE_PATH),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  bytes: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  slideId: z.string().regex(IDENTIFIER_PATTERN),
  order: z.number().int().min(0).max(X_POST_MAX_IMAGES - 1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();

const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal('xarticle'),
  platform: z.literal('x'),
  kind: z.literal('post'),
  articleId: z.string().regex(IDENTIFIER_PATTERN),
  exportedAt: z.string().datetime({ offset: true }),
  post: FileSchema.extend({
    path: z.literal('post.txt'),
    mimeType: z.literal('text/plain'),
    bytes: z.number().int().min(0).max(MAX_POST_BYTES),
  }).strict(),
  images: z.array(ImageSchema).max(X_POST_MAX_IMAGES),
}).strict().superRefine((manifest, context) => {
  const paths = new Set<string>();
  const orders = new Set<number>();
  const slideIds = new Set<string>();
  for (const image of manifest.images) {
    if (paths.has(image.path) || orders.has(image.order) || slideIds.has(image.slideId)) {
      context.addIssue({ code: 'custom', path: ['images'], message: 'X image metadata is duplicated.' });
    }
    paths.add(image.path);
    orders.add(image.order);
    slideIds.add(image.slideId);
  }
});

type Manifest = z.infer<typeof ManifestSchema>;

function isSafePath(value: string): boolean {
  if (!value || value.includes('\0') || value.includes('\\') || value.includes('%')) return false;
  if (value.startsWith('/') || value.startsWith('./') || value.includes('//')) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment && segment !== '.' && segment !== '..')
    && path.posix.normalize(value) === value;
}

function isSymbolicLink(entry: JSZip.JSZipObject): boolean {
  const permissions = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : 0;
  return (permissions & fsConstants.S_IFMT) === fsConstants.S_IFLNK;
}

async function verifiedEntry(
  zip: JSZip,
  metadata: Manifest['post'] | Manifest['images'][number],
): Promise<Uint8Array> {
  const entry = zip.file(metadata.path);
  if (!entry || entry.dir || isSymbolicLink(entry)) throw new Error('X bundle entry is missing or unsafe.');
  const bytes = await entry.async('uint8array');
  if (bytes.byteLength !== metadata.bytes || await sha256Hex(bytes) !== metadata.sha256) {
    throw new Error('X bundle entry integrity verification failed.');
  }
  return bytes;
}

export async function extractXPublicationBundle(bundlePath: string): Promise<{
  bundleDir: string;
  text: string;
  imagePaths: string[];
}> {
  const linkStat = await fs.lstat(bundlePath).catch(() => null);
  if (!linkStat?.isFile() || linkStat.isSymbolicLink() || linkStat.size > MAX_ARCHIVE_BYTES) {
    throw new Error('X publication bundle was not found or is oversized.');
  }
  const archive = await fs.readFile(bundlePath);
  const zip = await JSZip.loadAsync(archive, { checkCRC32: true, createFolders: false });
  const entries = Object.values(zip.files);
  if (entries.length < 2 || entries.length > X_POST_MAX_IMAGES + 2) {
    throw new Error('X publication bundle has an invalid entry count.');
  }
  for (const entry of entries) {
    const originalName = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
    if (
      entry.dir
      || isSymbolicLink(entry)
      || !isSafePath(entry.name)
      || (originalName !== undefined && originalName !== entry.name)
    ) {
      throw new Error('X publication bundle contains an unsafe path.');
    }
  }

  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) throw new Error('X publication manifest is missing.');
  const manifestBytes = await manifestEntry.async('uint8array');
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error('X publication manifest is oversized.');
  }
  let manifest: Manifest;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
    manifest = ManifestSchema.parse(JSON.parse(text));
  } catch {
    throw new Error('X publication manifest is invalid.');
  }

  const expectedPaths = new Set(['manifest.json', manifest.post.path, ...manifest.images.map((image) => image.path)]);
  if (entries.some((entry) => !expectedPaths.has(entry.name)) || expectedPaths.size !== entries.length) {
    throw new Error('X publication bundle contains an unlisted entry.');
  }

  const postBytes = await verifiedEntry(zip, manifest.post);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(postBytes);
  } catch {
    throw new Error('X publication post text is invalid UTF-8.');
  }
  if ([...text].length > X_POST_MAX_CHARACTERS || (!text.trim() && manifest.images.length === 0)) {
    throw new Error('X publication post content is invalid.');
  }

  const parent = path.join(os.tmpdir(), 'xarticle-publisher-x');
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const bundleDir = await fs.mkdtemp(path.join(parent, 'bundle-'));
  await fs.chmod(bundleDir, 0o700).catch(() => undefined);
  const imagePaths: string[] = [];
  let totalBytes = manifestBytes.byteLength + postBytes.byteLength;
  try {
    for (const image of [...manifest.images].sort((left, right) => left.order - right.order)) {
      const bytes = await verifiedEntry(zip, image);
      if (sniffImageMimeType(bytes) !== image.mimeType) {
        throw new Error('X publication image MIME verification failed.');
      }
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_EXTRACTED_BYTES) throw new Error('X publication bundle is oversized.');
      const destination = path.join(bundleDir, ...image.path.split('/'));
      const resolved = path.resolve(destination);
      if (!resolved.startsWith(`${path.resolve(bundleDir)}${path.sep}`)) {
        throw new Error('X publication image path is unsafe.');
      }
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await fs.writeFile(destination, bytes, { mode: 0o600, flag: 'wx' });
      imagePaths.push(destination);
    }
    return { bundleDir, text, imagePaths };
  } catch (error) {
    await fs.rm(bundleDir, { recursive: true, force: true });
    throw error;
  }
}
