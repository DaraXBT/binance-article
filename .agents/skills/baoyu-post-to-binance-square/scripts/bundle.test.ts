import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { zipSync } from 'fflate';

import {
  BUNDLE_LIMITS,
  BundleManifestSchema,
  validateBundleEntrySet,
  validateBundlePath,
  validateBundleArchive,
  validateImageSignature,
} from './bundle.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);

function manifest() {
  return {
    schemaVersion: 1,
    source: 'xarticle',
    articleId: 'article-1',
    exportedAt: '2026-07-18T00:00:00.000Z',
    title: 'Bundle title',
    markdown: {
      path: 'article.md', mimeType: 'text/markdown', bytes: 4, sha256: 'a'.repeat(64),
    },
    cover: {
      path: 'images/cover.jpg', sourceSlideId: 'slide-1', mimeType: 'image/jpeg',
      bytes: JPEG.byteLength, sha256: 'b'.repeat(64), width: 1000, height: 400,
    },
    images: [{
      path: 'images/01-slide.png', slideId: 'slide-1', order: 0,
      mimeType: 'image/png', bytes: PNG.byteLength, sha256: 'c'.repeat(64),
      width: 1600, height: 900,
    }],
  } as const;
}

test('BundleManifestSchema accepts the versioned xarticle contract', () => {
  assert.equal(BundleManifestSchema.parse(manifest()).schemaVersion, 1);
});

test('validateBundlePath accepts safe relative POSIX paths', () => {
  assert.equal(validateBundlePath('images/01-slide.png'), 'images/01-slide.png');
});

test('validateBundlePath rejects traversal, absolute, Windows, and ambiguous paths', () => {
  for (const candidate of [
    '../secret', '/tmp/secret', 'images/../../secret', 'C:\\secret',
    'images\\slide.png', './article.md', 'images//slide.png', 'images/./slide.png',
    'images/%2e%2e/secret', '\u0000secret',
  ]) {
    assert.throws(() => validateBundlePath(candidate), /unsafe|path/i, candidate);
  }
});

test('validateImageSignature requires declared MIME to match magic bytes', () => {
  assert.equal(validateImageSignature(PNG, 'image/png'), 'image/png');
  assert.equal(validateImageSignature(JPEG, 'image/jpeg'), 'image/jpeg');
  assert.throws(() => validateImageSignature(PNG, 'image/jpeg'), /signature|MIME/i);
  assert.throws(() => validateImageSignature(new Uint8Array([1, 2, 3]), 'image/png'), /signature/i);
});

test('validateBundleEntrySet rejects unlisted files and excessive image counts', () => {
  const expected = ['manifest.json', 'article.md', 'images/cover.jpg', 'images/01-slide.png'];
  assert.doesNotThrow(() => validateBundleEntrySet(expected, manifest()));
  assert.throws(
    () => validateBundleEntrySet([...expected, 'cookies.json'], manifest()),
    /unlisted|unexpected/i,
  );

  const tooMany = {
    ...manifest(),
    images: Array.from({ length: BUNDLE_LIMITS.maxImages + 1 }, (_, order) => ({
      ...manifest().images[0],
      order,
      slideId: `slide-${order}`,
      path: `images/${String(order + 1).padStart(2, '0')}-slide.png`,
    })),
  };
  assert.throws(() => BundleManifestSchema.parse(tooMany), /array|image/i);
});

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

test('validateBundleArchive round-trips a valid ZIP and verifies every hash', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bs-valid-bundle-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const markdown = new TextEncoder().encode('Intro\n\n## Slide\n\n![Slide](images/01-slide.png)');
  const validManifest = {
    ...manifest(),
    markdown: { ...manifest().markdown, bytes: markdown.byteLength, sha256: sha256(markdown) },
    cover: { ...manifest().cover, bytes: JPEG.byteLength, sha256: sha256(JPEG) },
    images: [{ ...manifest().images[0], bytes: PNG.byteLength, sha256: sha256(PNG) }],
  };
  const archive = zipSync({
    'article.md': markdown,
    'manifest.json': new TextEncoder().encode(JSON.stringify(validManifest)),
    'images/cover.jpg': JPEG,
    'images/01-slide.png': PNG,
  });
  const bundlePath = path.join(root, 'bundle.zip');
  await fs.writeFile(bundlePath, archive);

  const result = await validateBundleArchive(bundlePath);
  assert.equal(result.manifest.title, 'Bundle title');
  assert.equal(result.markdown, new TextDecoder().decode(markdown));
  assert.equal(result.entries.size, 4);
});

test('validateBundleArchive rejects ZIP traversal and symbolic-link entries', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bs-hostile-bundle-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const traversalPath = path.join(root, 'traversal.zip');
  await fs.writeFile(traversalPath, zipSync({ '../secret.txt': new Uint8Array([1]) }));
  await assert.rejects(validateBundleArchive(traversalPath), /unsafe.*path/i);

  const symlink = zipSync({ 'images/link.png': PNG });
  const view = new DataView(symlink.buffer, symlink.byteOffset, symlink.byteLength);
  for (let offset = 0; offset + 46 <= symlink.length; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      view.setUint32(offset + 38, 0o120777 << 16, true);
      break;
    }
  }
  const symlinkPath = path.join(root, 'symlink.zip');
  await fs.writeFile(symlinkPath, symlink);
  await assert.rejects(validateBundleArchive(symlinkPath), /symbolic link/i);
});
