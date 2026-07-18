import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { zipSync } from '../scripts/node_modules/fflate/esm/browser.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const filesDir = path.join(root, 'files');
const encoder = new TextEncoder();
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function bundle(title: string, markdownText: string): Uint8Array {
  const markdown = encoder.encode(markdownText);
  const manifest = {
    schemaVersion: 1,
    source: 'xarticle',
    articleId: `eval-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    exportedAt: '2026-07-18T00:00:00.000Z',
    title,
    markdown: { path: 'article.md', mimeType: 'text/markdown', bytes: markdown.length, sha256: sha256(markdown) },
    cover: {
      path: 'images/cover.jpg', sourceSlideId: 'slide-1', mimeType: 'image/jpeg',
      bytes: jpeg.length, sha256: sha256(jpeg), width: 1000, height: 400,
    },
    images: [{
      path: 'images/01-slide.png', slideId: 'slide-1', order: 0, mimeType: 'image/png',
      bytes: png.length, sha256: sha256(png), width: 1600, height: 900,
    }],
  };
  return zipSync({
    'article.md': markdown,
    'manifest.json': encoder.encode(JSON.stringify(manifest)),
    'images/cover.jpg': jpeg,
    'images/01-slide.png': png,
  });
}

await fs.mkdir(filesDir, { recursive: true });
await fs.writeFile(path.join(filesDir, 'standard.zip'), bundle(
  'Standard article',
  'A short introduction.\n\n## Market setup\n\n![Market setup](images/01-slide.png)\n\n#BTC #Crypto\n',
));
await fs.writeFile(path.join(filesDir, 'rich.zip'), bundle(
  'Rich Markdown article',
  [
    'A technical introduction.', '', '## Architecture', '', '### Data flow', '',
    '- Validate input', '- Compose the editor', '', '> Review before publishing.', '',
    '```typescript', 'const safe = true;', '```', '',
    '| Check | Result |', '| --- | --- |', '| Hashes | Verified |', '',
    '![Architecture](images/01-slide.png)', '', '#Bitcoin $BTC', '',
  ].join('\n'),
));
await fs.writeFile(path.join(filesDir, 'malicious-traversal.zip'), zipSync({
  '../cookies.json': encoder.encode('{"cookie":"stolen"}'),
}));
