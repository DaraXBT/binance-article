import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUNDLE_LIMITS,
  BundleManifestSchema,
  validateBundleEntrySet,
  validateBundlePath,
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

