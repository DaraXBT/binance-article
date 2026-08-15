import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';
import sharp from 'sharp';

import { parseMarkdown as parseBinanceMarkdown } from '../../.agents/skills/baoyu-post-to-binance-square/scripts/md-to-html';
import { parseMarkdown as parseXMarkdown } from '../../.agents/skills/baoyu-post-to-x/scripts/md-to-html';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(markdown: string) {
  const root = await mkdtemp(join(tmpdir(), 'publication-cover-policy-'));
  roots.push(root);
  const image = await sharp({
    create: { width: 32, height: 18, channels: 3, background: 'blue' },
  }).png().toBuffer();
  await writeFile(join(root, 'body.png'), image);
  await writeFile(join(root, 'cover.png'), image);
  const articlePath = join(root, 'article.md');
  await writeFile(articlePath, markdown);
  return { articlePath, root };
}

describe('reviewed Article cover policy', () => {
  it('keeps a Binance body image in the body when implicit cover discovery is disabled', async () => {
    const { articlePath, root } = await fixture('# Title\n\nBody text.\n\n![Chart](./body.png)\n');

    const parsed = await parseBinanceMarkdown(articlePath, {
      inferCoverFromFirstImage: false,
      tempDir: join(root, 'resolved'),
    });

    expect(parsed.coverImage).toBeNull();
    expect(parsed.contentImages).toHaveLength(1);
    expect(parsed.contentImages[0]?.originalPath).toBe('./body.png');
  });

  it.each([
    ['X', parseXMarkdown],
    ['Binance', parseBinanceMarkdown],
  ] as const)('ignores document and nearby covers for a coverless reviewed %s Article', async (
    _platform,
    parseMarkdown,
  ) => {
    const { articlePath, root } = await fixture([
      '---',
      'cover_image: ./cover.png',
      '---',
      '# Title',
      '',
      'Body text.',
      '',
      '![Chart](./body.png)',
    ].join('\n'));

    const parsed = await parseMarkdown(articlePath, {
      inferCoverFromFirstImage: false,
      tempDir: join(root, 'resolved'),
    });

    expect(parsed.coverImage).toBeNull();
    expect(parsed.contentImages).toHaveLength(1);
  });

  it.each([
    ['X', parseXMarkdown],
    ['Binance', parseBinanceMarkdown],
  ] as const)('uses only the explicit reviewed cover for a %s Article', async (
    _platform,
    parseMarkdown,
  ) => {
    const { articlePath, root } = await fixture('# Title\n\n![Chart](./body.png)\n');
    const explicitCover = join(root, 'cover.png');

    const parsed = await parseMarkdown(articlePath, {
      coverImage: explicitCover,
      inferCoverFromFirstImage: false,
      tempDir: join(root, 'resolved'),
    });

    expect(parsed.coverImage).toBe(explicitCover);
    expect(parsed.contentImages).toHaveLength(1);
  });
});
