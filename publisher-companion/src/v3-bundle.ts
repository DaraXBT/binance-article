import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import { z } from 'zod';

import {
  BINANCE_POST_MAX_CHARACTERS,
  BINANCE_POST_MAX_IMAGES,
  X_POST_MAX_CHARACTERS,
  X_POST_MAX_IMAGES,
  type PublicationKind,
  type PublicationTarget,
} from '../../server/domain/publication-recipe';
import {
  getMarkdownImageReferenceErrors,
} from '../../.agents/skills/baoyu-post-to-binance-square/scripts/markdown-image-references';

import { sha256Hex, sniffImageMimeType } from './asset-download';

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_CONTENT_BYTES = 400 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

const FileSchema = z.object({
  path: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(64),
  bytes: z.number().int().min(0).max(MAX_ARCHIVE_BYTES),
  sha256: z.string().regex(HASH_PATTERN),
}).strict();

const ImageSchema = FileSchema.extend({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  bytes: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  slideId: z.string().regex(IDENTIFIER_PATTERN),
  order: z.number().int().min(0).max(9),
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000),
}).strict();

const CoverSchema = FileSchema.extend({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sourceSlideId: z.string().regex(IDENTIFIER_PATTERN),
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000),
}).strict();

const ManifestSchema = z.object({
  schemaVersion: z.literal(2),
  source: z.literal('xarticle'),
  platform: z.enum(['binance-square', 'x']),
  kind: z.enum(['post', 'article']),
  articleId: z.string().regex(IDENTIFIER_PATTERN),
  exportedAt: z.string().datetime({ offset: true }),
  title: z.string().trim().min(1).max(200).optional(),
  content: FileSchema.extend({
    path: z.enum(['post.txt', 'article.md']),
    mimeType: z.enum(['text/plain', 'text/markdown']),
    bytes: z.number().int().min(0).max(MAX_CONTENT_BYTES),
  }).strict(),
  cover: CoverSchema.optional(),
  images: z.array(ImageSchema).max(10),
}).strict();

type Manifest = z.infer<typeof ManifestSchema>;

export type ExtractedV3Bundle = {
  bundleDir: string;
  contentPath: string;
  content: string;
  title?: string;
  coverPath?: string;
  imagePaths: string[];
  manifest: Manifest;
};

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

function expectedImagePath(
  target: PublicationTarget,
  kind: PublicationKind,
  order: number,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp',
): string {
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp';
  const suffix = kind === 'post' ? 'post' : target === 'x' ? 'body' : 'slide';
  return `images/${String(order + 1).padStart(2, '0')}-${suffix}.${extension}`;
}

function assertManifestContract(
  manifest: Manifest,
  expected: { target: PublicationTarget; kind: PublicationKind },
): void {
  if (manifest.platform !== expected.target || manifest.kind !== expected.kind) {
    throw new Error('Publication bundle target or kind does not match the selected adapter.');
  }
  const article = expected.kind === 'article';
  if (
    manifest.content.path !== (article ? 'article.md' : 'post.txt')
    || manifest.content.mimeType !== (article ? 'text/markdown' : 'text/plain')
    || article !== Boolean(manifest.title)
    || (!article && manifest.cover !== undefined)
  ) {
    throw new Error('Publication bundle content metadata is invalid.');
  }
  const maximumImages = article
    ? 10
    : expected.target === 'x' ? X_POST_MAX_IMAGES : BINANCE_POST_MAX_IMAGES;
  if (manifest.images.length > maximumImages) {
    throw new Error('Publication bundle contains too many images.');
  }
  const paths = new Set<string>();
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const [index, image] of manifest.images.entries()) {
    if (
      image.order !== index
      || image.path !== expectedImagePath(expected.target, expected.kind, image.order, image.mimeType)
      || paths.has(image.path)
      || ids.has(image.slideId)
      || orders.has(image.order)
    ) {
      throw new Error('Publication bundle image metadata is invalid or duplicated.');
    }
    paths.add(image.path);
    ids.add(image.slideId);
    orders.add(image.order);
  }
  if (manifest.cover) {
    if (!/^images\/cover\.(?:jpg|png|webp)$/.test(manifest.cover.path) || paths.has(manifest.cover.path)) {
      throw new Error('Publication bundle cover metadata is invalid.');
    }
  }
}

async function verifiedEntry(
  zip: JSZip,
  metadata: z.infer<typeof FileSchema>,
): Promise<Uint8Array> {
  const entry = zip.file(metadata.path);
  if (!entry || entry.dir || isSymbolicLink(entry)) {
    throw new Error('Publication bundle entry is missing or unsafe.');
  }
  const bytes = await entry.async('uint8array');
  if (bytes.byteLength !== metadata.bytes || await sha256Hex(bytes) !== metadata.sha256) {
    throw new Error('Publication bundle entry integrity verification failed.');
  }
  return bytes;
}

function assertArticleImageReferences(markdown: string, manifest: Manifest): void {
  const errors = getMarkdownImageReferenceErrors(
    markdown,
    manifest.images.map((image) => image.path),
    'Publication Article Markdown',
  );
  if (errors[0]) throw new Error(errors[0]);
}

export async function extractV3PublicationBundle(
  bundlePath: string,
  expected: { target: PublicationTarget; kind: PublicationKind },
): Promise<ExtractedV3Bundle> {
  const stat = await fs.lstat(bundlePath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARCHIVE_BYTES) {
    throw new Error('Publication bundle was not found or is oversized.');
  }
  const zip = await JSZip.loadAsync(await fs.readFile(bundlePath), {
    checkCRC32: true,
    createFolders: false,
  });
  const entries = Object.values(zip.files);
  for (const entry of entries) {
    const originalName = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
    if (
      entry.dir
      || isSymbolicLink(entry)
      || !isSafePath(entry.name)
      || (originalName !== undefined && originalName !== entry.name)
    ) {
      throw new Error('Publication bundle contains an unsafe path.');
    }
  }
  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) throw new Error('Publication bundle manifest is missing.');
  const manifestBytes = await manifestEntry.async('uint8array');
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error('Publication bundle manifest is oversized.');
  }
  let manifest: Manifest;
  try {
    manifest = ManifestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)));
    assertManifestContract(manifest, expected);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Publication bundle')) throw error;
    throw new Error('Publication bundle manifest is invalid.');
  }
  const expectedPaths = new Set([
    'manifest.json',
    manifest.content.path,
    ...(manifest.cover ? [manifest.cover.path] : []),
    ...manifest.images.map((image) => image.path),
  ]);
  if (entries.length !== expectedPaths.size || entries.some((entry) => !expectedPaths.has(entry.name))) {
    throw new Error('Publication bundle contains an unlisted entry.');
  }
  const contentBytes = await verifiedEntry(zip, manifest.content);
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(contentBytes);
  } catch {
    throw new Error('Publication bundle content is invalid UTF-8.');
  }
  if (expected.kind === 'article') {
    if (!content.trim()) throw new Error('Publication article content is empty.');
    assertArticleImageReferences(content, manifest);
  } else {
    const maximum = expected.target === 'x' ? X_POST_MAX_CHARACTERS : BINANCE_POST_MAX_CHARACTERS;
    if ([...content.trim()].length > maximum || (!content.trim() && manifest.images.length === 0)) {
      throw new Error('Publication post content is invalid.');
    }
  }

  const root = path.join(os.tmpdir(), `xarticle-publisher-${expected.target}-${expected.kind}`);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const bundleDir = await fs.mkdtemp(path.join(root, 'bundle-'));
  await fs.chmod(bundleDir, 0o700).catch(() => undefined);
  const contentPath = path.join(bundleDir, manifest.content.path);
  let totalBytes = manifestBytes.byteLength + contentBytes.byteLength;
  try {
    await fs.writeFile(contentPath, contentBytes, { mode: 0o600, flag: 'wx' });
    const imagePaths: string[] = [];
    let coverPath: string | undefined;
    const media = [...(manifest.cover ? [manifest.cover] : []), ...manifest.images];
    for (const metadata of media) {
      const bytes = await verifiedEntry(zip, metadata);
      if (sniffImageMimeType(bytes) !== metadata.mimeType) {
        throw new Error('Publication bundle image MIME verification failed.');
      }
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error('Publication bundle is oversized.');
      const destination = path.join(bundleDir, ...metadata.path.split('/'));
      if (!path.resolve(destination).startsWith(`${path.resolve(bundleDir)}${path.sep}`)) {
        throw new Error('Publication bundle image path is unsafe.');
      }
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await fs.writeFile(destination, bytes, { mode: 0o600, flag: 'wx' });
      if (manifest.cover && metadata.path === manifest.cover.path) coverPath = destination;
      else imagePaths.push(destination);
    }
    return {
      bundleDir,
      contentPath,
      content,
      ...(manifest.title ? { title: manifest.title } : {}),
      ...(coverPath ? { coverPath } : {}),
      imagePaths,
      manifest,
    };
  } catch (error) {
    await fs.rm(bundleDir, { recursive: true, force: true });
    throw error;
  }
}
