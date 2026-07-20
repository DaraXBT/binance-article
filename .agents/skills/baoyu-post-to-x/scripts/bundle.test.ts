import { describe, expect, test } from 'bun:test';

import {
  XBundleManifestSchema,
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

describe('X post bundle validation', () => {
  test('accepts the bounded xArticle manifest contract', () => {
    expect(XBundleManifestSchema.parse(validManifest)).toEqual(validManifest);
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
});
