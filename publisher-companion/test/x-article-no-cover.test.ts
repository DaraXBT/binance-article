import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';
import sharp from 'sharp';

import { parseMarkdown } from '../../.agents/skills/baoyu-post-to-x/scripts/md-to-html';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('reviewed X Article cover policy', () => {
  it('keeps the first body image in the body when cover inference is disabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xarticle-no-cover-'));
    roots.push(root);
    const articlePath = join(root, 'article.md');
    const imagePath = join(root, 'chart.png');
    await writeFile(imagePath, await sharp({
      create: { width: 32, height: 18, channels: 3, background: 'blue' },
    }).png().toBuffer());
    await writeFile(articlePath, '# Title\n\nBody text.\n\n![Chart](./chart.png)\n');

    const parsed = await parseMarkdown(articlePath, {
      inferCoverFromFirstImage: false,
      tempDir: join(root, 'resolved'),
    });

    expect(parsed.coverImage).toBeNull();
    expect(parsed.contentImages).toHaveLength(1);
    expect(parsed.contentImages[0]?.originalPath).toBe('./chart.png');
  });
});
