import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';
import { zipSync } from 'fflate';

import {
  XBundleManifestSchema,
  extractValidatedXPostBundle,
  validateXPostBundleArchive,
  validateBundlePath,
  validateImageSignature,
} from './bundle.js';

const validManifest = {
  schemaVersion: 1,
  source: 'xarticle',
  platform: 'x',
  kind: 'post',
  articleId: 'article-1',
  exportedAt: '2026-07-20T00:00:00.000Z',
  post: {
    path: 'post.txt',
    mimeType: 'text/plain',
    bytes: 4,
    sha256: 'a'.repeat(64),
  },
  images: [{
    path: 'images/01-post.png',
    mimeType: 'image/png',
    bytes: 8,
    sha256: 'b'.repeat(64),
    slideId: 'slide-1',
    order: 0,
    width: 1600,
    height: 900,
  }],
};

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function makeArchive(options: {
  text?: Uint8Array;
  image?: Uint8Array;
  manifest?: Record<string, unknown>;
  extraEntries?: Record<string, Uint8Array>;
} = {}): Uint8Array {
  const text = options.text ?? new TextEncoder().encode('Reviewed post');
  const image = options.image ?? PNG_BYTES;
  const manifest = options.manifest ?? {
    schemaVersion: 1,
    source: 'xarticle',
    platform: 'x',
    kind: 'post',
    articleId: 'article-1',
    exportedAt: '2026-07-20T00:00:00.000Z',
    post: {
      path: 'post.txt',
      mimeType: 'text/plain',
      bytes: text.byteLength,
      sha256: sha256(text),
    },
    images: [{
      path: 'images/01-post.png',
      mimeType: 'image/png',
      bytes: image.byteLength,
      sha256: sha256(image),
      slideId: 'slide-1',
      order: 0,
      width: 1,
      height: 1,
    }],
  };

  return zipSync({
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'post.txt': text,
    'images/01-post.png': image,
    ...(options.extraEntries ?? {}),
  });
}

describe('X post bundle validation', () => {
  test('accepts the bounded xArticle manifest contract', () => {
    expect(XBundleManifestSchema.parse(validManifest)).toEqual(validManifest);
  });

  test('requires deterministic image paths to match image order and MIME type', () => {
    expect(() => XBundleManifestSchema.parse({
      ...validManifest,
      images: [{ ...validManifest.images[0], path: 'images/02-post.png' }],
    })).toThrow(/match its image order/i);
  });

  test('rejects unsafe article and slide identifiers', () => {
    expect(() => XBundleManifestSchema.parse({
      ...validManifest,
      articleId: '../article',
    })).toThrow(/articleId is invalid/i);
    expect(() => XBundleManifestSchema.parse({
      ...validManifest,
      images: [{ ...validManifest.images[0], slideId: '\u001b[31mspoofed' }],
    })).toThrow(/slideId is invalid/i);
  });

  test('rejects traversal, absolute, encoded, and duplicate-separator paths', () => {
    for (const unsafe of ['../post.txt', '/tmp/post.txt', 'C:/post.txt', 'images%2Fsecret.png', 'images//post.png']) {
      expect(() => validateBundlePath(unsafe)).toThrow();
    }
  });

  test('checks image signatures against the declared MIME type', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(validateImageSignature(png, 'image/png')).toBe('image/png');
    expect(() => validateImageSignature(png, 'image/jpeg')).toThrow(/MIME mismatch/i);
  });

  test('validates and extracts a real ZIP with only the listed files', async () => {
    const archivePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'x-bundle-test-')), 'post.zip');
    const imageWithZipSignature = new Uint8Array([
      ...PNG_BYTES,
      0x50, 0x4b, 0x01, 0x02,
      0x00, 0x00, 0xff, 0xff,
    ]);
    await fs.writeFile(archivePath, makeArchive({ image: imageWithZipSignature }));

    const validated = await validateXPostBundleArchive(archivePath);
    expect(validated.text).toBe('Reviewed post');
    expect([...validated.entries.keys()]).toEqual([
      'manifest.json',
      'post.txt',
      'images/01-post.png',
    ]);

    const extracted = await extractValidatedXPostBundle(archivePath);
    try {
      expect(await fs.readFile(extracted.postPath, 'utf8')).toBe('Reviewed post');
      expect(extracted.imagePaths).toHaveLength(1);
      expect(await fs.readFile(extracted.imagePaths[0]!)).toEqual(Buffer.from(imageWithZipSignature));
    } finally {
      await fs.rm(path.dirname(archivePath), { recursive: true, force: true });
      await fs.rm(extracted.bundleDir, { recursive: true, force: true });
    }
  });

  test('rejects unlisted entries and traversal names before extraction', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'x-bundle-invalid-'));
    try {
      const unlistedPath = path.join(root, 'unlisted.zip');
      await fs.writeFile(unlistedPath, makeArchive({ extraEntries: { 'notes.txt': new Uint8Array([1]) } }));
      await expect(validateXPostBundleArchive(unlistedPath)).rejects.toThrow(/unexpected or unlisted/i);

      const traversalPath = path.join(root, 'traversal.zip');
      await fs.writeFile(traversalPath, makeArchive({ extraEntries: { '../outside.txt': new Uint8Array([1]) } }));
      await expect(validateXPostBundleArchive(traversalPath)).rejects.toThrow(/unsafe bundle path/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('rejects hash mismatches and oversized text before writing files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'x-bundle-limits-'));
    try {
      const mismatch = path.join(root, 'mismatch.zip');
      const badManifest = {
        ...validManifest,
        post: { ...validManifest.post, sha256: 'f'.repeat(64) },
      };
      await fs.writeFile(mismatch, makeArchive({
        text: new TextEncoder().encode('test'),
        manifest: badManifest,
      }));
      await expect(validateXPostBundleArchive(mismatch)).rejects.toThrow(/SHA-256 mismatch/i);

      const longPost = path.join(root, 'long-post.zip');
      await fs.writeFile(longPost, makeArchive({
        text: new TextEncoder().encode('x'.repeat(281)),
      }));
      await expect(validateXPostBundleArchive(longPost)).rejects.toThrow(/280 characters/i);

      const oversizedText = new Uint8Array(100 * 1024 + 1).fill(0x78);
      const oversized = path.join(root, 'oversized.zip');
      await fs.writeFile(oversized, makeArchive({ text: oversizedText }));
      await expect(validateXPostBundleArchive(oversized)).rejects.toThrow(/size limit|post\.txt/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('reports malformed tiny archives as validation errors', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'x-bundle-malformed-'));
    const archivePath = path.join(root, 'tiny.zip');
    try {
      await fs.writeFile(archivePath, new Uint8Array([0x50, 0x4b, 0x03]));
      await expect(validateXPostBundleArchive(archivePath)).rejects.toThrow(/ZIP|central|end-of-central/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('rejects ZIP entries marked as symbolic links', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'x-bundle-link-'));
    const archivePath = path.join(root, 'link.zip');
    try {
      const archive = makeArchive();
      const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
      let centralOffset = -1;
      for (let offset = 0; offset + 46 <= archive.byteLength; offset += 1) {
        if (view.getUint32(offset, true) === 0x02014b50) {
          centralOffset = offset;
          break;
        }
      }
      expect(centralOffset).toBeGreaterThanOrEqual(0);
      // Unix file type 0120000 (symlink), stored in the upper external-attrs word.
      view.setUint32(centralOffset + 38, 0xa0000000, true);
      await fs.writeFile(archivePath, archive);
      await expect(validateXPostBundleArchive(archivePath)).rejects.toThrow(/symbolic link/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
