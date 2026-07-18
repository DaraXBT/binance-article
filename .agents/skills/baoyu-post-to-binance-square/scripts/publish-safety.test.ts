import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BS_SELECTORS } from './binance-utils.ts';
import { parseMarkdown } from './md-to-html.ts';
import {
  assertCompositionReady,
  evaluatePublishEvidence,
} from './publish-safety.ts';

test('article publish selectors avoid generic submit and class-name fallbacks', () => {
  assert.ok(BS_SELECTORS.articlePublishButton.length > 0);
  assert.ok(BS_SELECTORS.articlePublishButton.every((selector) =>
    !selector.includes('type="submit"') && !selector.includes('class*="publish"')
  ));
});

test('composition failures block publication', () => {
  assert.throws(() => assertCompositionReady({
    titleMatches: true,
    bodyMatches: true,
    expectedImages: 2,
    actualImages: 1,
    remainingPlaceholders: [],
    expectedCodeBlocks: 0,
    actualCodeBlocks: 0,
  }), /composition|image/i);

  assert.doesNotThrow(() => assertCompositionReady({
    titleMatches: true,
    bodyMatches: true,
    expectedImages: 2,
    actualImages: 2,
    remainingPlaceholders: [],
    expectedCodeBlocks: 1,
    actualCodeBlocks: 1,
  }));
});

test('publish success requires verifiable Binance evidence', () => {
  assert.equal(evaluatePublishEvidence({
    beforeUrl: 'https://www.binance.com/en/square/creator-center/article/editor',
    afterUrl: 'https://www.binance.com/en/square/post/123456',
    successToast: false,
    editorVisible: false,
  }).verified, true);

  assert.equal(evaluatePublishEvidence({
    beforeUrl: 'https://www.binance.com/en/square/creator-center/article/editor',
    afterUrl: 'https://www.binance.com/en/square/creator-center/article/editor',
    successToast: false,
    editorVisible: true,
  }).verified, false);
});

test('generated placeholders cannot collide with author content', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bs-placeholder-collision-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'image.png'), 'png');
  const markdownPath = path.join(root, 'article.md');
  await fs.writeFile(markdownPath, [
    '# Collision test', '', 'Literal BSIMGPH_1 and BSCODEPH_1 must survive.', '',
    '![real](image.png)', '', '```js', 'const ok = true;', '```',
  ].join('\n'));

  const result = await parseMarkdown(markdownPath, { tempDir: path.join(root, 'tmp') });
  assert.match(result.html, /Literal BSIMGPH_1 and BSCODEPH_1 must survive/);
  assert.notEqual(result.contentImages[0]?.placeholder, 'BSIMGPH_1');
  assert.notEqual(result.codeBlocks[0]?.placeholder, 'BSCODEPH_1');
});
