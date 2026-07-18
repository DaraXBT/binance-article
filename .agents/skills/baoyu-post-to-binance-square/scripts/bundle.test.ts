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

async function writeBundle(
  root: string,
  name: string,
  markdownText: string,
  options: { images?: readonly (ReturnType<typeof manifest>['images'][number])[] } = {},
): Promise<string> {
  const markdown = new TextEncoder().encode(markdownText);
  const images = options.images ?? manifest().images;
  const bundleManifest = {
    ...manifest(),
    markdown: { ...manifest().markdown, bytes: markdown.byteLength, sha256: sha256(markdown) },
    cover: { ...manifest().cover, bytes: JPEG.byteLength, sha256: sha256(JPEG) },
    images: images.map((image) => ({ ...image, bytes: PNG.byteLength, sha256: sha256(PNG) })),
  };
  const entries: Record<string, Uint8Array> = {
    'article.md': markdown,
    'manifest.json': new TextEncoder().encode(JSON.stringify(bundleManifest)),
    'images/cover.jpg': JPEG,
  };
  for (const image of bundleManifest.images) entries[image.path] = PNG;
  const bundlePath = path.join(root, name);
  await fs.writeFile(bundlePath, zipSync(entries));
  return bundlePath;
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

test('validateBundleArchive rejects a filesystem symlink before reading it', async (t) => {
  if (process.platform === 'win32') return t.skip('Filesystem symlink creation requires elevated privileges on Windows.');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bs-symlink-archive-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundlePath = await writeBundle(root, 'source.zip', '![Slide](images/01-slide.png)');
  const linkPath = path.join(root, 'bundle-link.zip');
  await fs.symlink(bundlePath, linkPath);
  await assert.rejects(validateBundleArchive(linkPath), /not found|safely/i);
});

test('validateBundleArchive rejects bundles whose Markdown drops a listed image', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bs-image-reference-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const markdown = new TextEncoder().encode('No image reference here.');
  const invalidManifest = {
    ...manifest(),
    markdown: { ...manifest().markdown, bytes: markdown.byteLength, sha256: sha256(markdown) },
    cover: { ...manifest().cover, bytes: JPEG.byteLength, sha256: sha256(JPEG) },
    images: [{ ...manifest().images[0], bytes: PNG.byteLength, sha256: sha256(PNG) }],
  };
  const bundlePath = path.join(root, 'missing-reference.zip');
  await fs.writeFile(bundlePath, zipSync({
    'article.md': markdown,
    'manifest.json': new TextEncoder().encode(JSON.stringify(invalidManifest)),
    'images/cover.jpg': JPEG,
    'images/01-slide.png': PNG,
  }));
  await assert.rejects(validateBundleArchive(bundlePath), /must reference (?:the )?bundled image.*exactly once/i);
});

test('validateBundleArchive binds parsed image destinations to the manifest', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bs-image-destinations-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const cases = [
    {
      name: 'alt-remote.zip',
      markdown: '![images/01-slide.png](https://example.invalid/private.png)',
      expected: /unbundled or unsafe.*https:/i,
    },
    {
      name: 'code-hidden.zip',
      markdown: '```text\nimages/01-slide.png\n```',
      expected: /must reference (?:the )?bundled image/i,
    },
    {
      name: 'remote-extra.zip',
      markdown: '![Slide](images/01-slide.png)\n\n![Remote](https://example.invalid/remote.png)',
      expected: /unbundled or unsafe.*https:/i,
    },
    {
      name: 'absolute-extra.zip',
      markdown: '![Slide](images/01-slide.png)\n\n![Secret](/Users/alice/secret.png)',
      expected: /unbundled or unsafe.*\/Users\/alice/i,
    },
    {
      name: 'raw-html.zip',
      markdown: '![Slide](images/01-slide.png)\n\n<img src="https://example.invalid/raw.png">',
      expected: /raw HTML image/i,
    },
    {
      name: 'resource-html.zip',
      markdown: '![Slide](images/01-slide.png)\n\n<iframe src="http://127.0.0.1/private"></iframe>',
      expected: /unsupported raw HTML/i,
    },
    {
      name: 'escaped-remote.zip',
      markdown: '![Slide](images/01-slide.png)\n\n\\![Remote](https://example.invalid/escaped.png)',
      expected: /unsupported image syntax/i,
    },
    {
      name: 'nested-alt-local.zip',
      markdown: '![outer[inner](/Users/alice/secret.png) text](images/01-slide.png)',
      expected: /unbundled or unsafe.*\/Users\/alice/i,
    },
    {
      name: 'inline-code-local.zip',
      markdown: '![Slide](images/01-slide.png)\n\n`![Secret](/etc/passwd)`',
      expected: /inside code/i,
    },
    {
      name: 'inline-code-wikilink-local.zip',
      markdown: '![Slide](images/01-slide.png)\n\n`![[/Users/alice/secret.png]]`',
      expected: /inside code/i,
    },
    {
      name: 'mermaid-generated-image.zip',
      markdown: '![Slide](images/01-slide.png)\n\n```mermaid\ngraph TD\nA --> B\n```',
      expected: /cannot contain Mermaid blocks/i,
    },
    {
      name: 'nested-mermaid-generated-image.zip',
      markdown: '![Slide](images/01-slide.png)\n\n> ```mermaid\n> graph TD\n> A --> B\n> ```',
      expected: /cannot contain Mermaid blocks/i,
    },
  ] as const;

  for (const fixture of cases) {
    const bundlePath = await writeBundle(root, fixture.name, fixture.markdown);
    await assert.rejects(validateBundleArchive(bundlePath), fixture.expected, fixture.name);
  }
});

test('validateBundleArchive preserves articles with no body images', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bs-zero-images-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundlePath = await writeBundle(root, 'zero-images.zip', '<u>Text-only</u> article.', { images: [] });
  const validated = await validateBundleArchive(bundlePath);
  assert.equal(validated.manifest.images.length, 0);
});
