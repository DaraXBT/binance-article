import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  X_POST_MAX_CHARACTERS,
  XPostBundleManifestSchema,
  createXPostBundle,
  getXPostExportIssues,
  getXPostImagePath,
} from './x-export';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('getXPostImagePath', () => {
  it('creates deterministic paths for the four supported post images', () => {
    expect(getXPostImagePath(0, 'image/png')).toBe('images/01-post.png');
    expect(getXPostImagePath(3, 'image/jpeg')).toBe('images/04-post.jpg');
    expect(() => getXPostImagePath(4, 'image/png')).toThrow(/between 0 and 3/i);
  });
});

describe('getXPostExportIssues', () => {
  it('requires content, enforces four images, and treats the standard post limit as guidance', () => {
    expect(getXPostExportIssues({ text: '', selectedImageCount: 0 }).errors)
      .toContain('Add post text or select at least one image.');
    expect(getXPostExportIssues({ text: 'Post', selectedImageCount: 5 }).errors)
      .toContain('X posts support at most 4 images.');
    expect(getXPostExportIssues({ text: 'x'.repeat(281), selectedImageCount: 0 }).warnings)
      .toContain('This post exceeds 280 characters and requires an eligible X account.');
    expect(getXPostExportIssues({
      text: 'x'.repeat(X_POST_MAX_CHARACTERS + 1),
      selectedImageCount: 0,
    }).errors).toContain(`X post text must be ${X_POST_MAX_CHARACTERS.toLocaleString()} characters or fewer.`);
  });
});

describe('createXPostBundle', () => {
  it('creates a schema-valid ZIP with hashed local text and image assets', async () => {
    const { bytes, manifest } = await createXPostBundle({
      articleId: 'article-123',
      exportedAt: new Date('2026-07-20T00:00:00.000Z'),
      text: 'A reviewed X post.',
      images: [{
        slideId: 'slide-1',
        order: 0,
        path: 'images/01-post.png',
        bytes: PNG_BYTES,
        mimeType: 'image/png',
        width: 1600,
        height: 900,
      }],
    });

    expect(XPostBundleManifestSchema.parse(manifest)).toEqual(manifest);
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file('post.txt')?.async('string')).toBe('A reviewed X post.');
    expect(await zip.file('images/01-post.png')?.async('uint8array')).toEqual(PNG_BYTES);
    expect(JSON.parse(await zip.file('manifest.json')!.async('string'))).toEqual(manifest);
    expect(manifest.post.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.images[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(manifest)).not.toMatch(/cookie|workspaceKey|accessKey|token/i);
  });

  it('rejects unsafe or oversized direct bundle input', async () => {
    await expect(createXPostBundle({
      articleId: 'article-123',
      text: 'Post',
      images: [{
        slideId: 'slide-1',
        order: 0,
        path: '../private.png',
        bytes: PNG_BYTES,
        mimeType: 'image/png',
        width: 1,
        height: 1,
      }],
    })).rejects.toThrow(/unsafe image path/i);

    await expect(createXPostBundle({
      articleId: 'article-123',
      text: 'Post',
      images: Array.from({ length: 5 }, (_, order) => ({
        slideId: `slide-${order}`,
        order,
        path: `images/0${order + 1}-post.png`,
        bytes: PNG_BYTES,
        mimeType: 'image/png' as const,
        width: 1,
        height: 1,
      })),
    })).rejects.toThrow(/maximum of 4 images/i);
  });
});
