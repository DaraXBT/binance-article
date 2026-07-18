import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseMarkdown } from './md-to-html.ts';

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('parseMarkdown preserves mixed markdown and Obsidian wikilink image order', async (t) => {
  const root = await makeTempDir('bs-md-to-html-wikilinks-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const articleDir = path.join(root, 'article');
  const attachmentsDir = path.join(articleDir, 'Attachments');
  const tempDir = path.join(root, 'tmp');
  await fs.mkdir(attachmentsDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(path.join(articleDir, 'a.png'), 'a');
  await fs.writeFile(path.join(articleDir, 'b.jpg'), 'b');
  await fs.writeFile(path.join(attachmentsDir, 'c.webp'), 'c');

  const markdownPath = path.join(articleDir, 'post.md');
  await fs.writeFile(
    markdownPath,
    [
      '# Title',
      '',
      '![[a.png]]',
      '',
      '![B alt](b.jpg)',
      '',
      '![[c.webp|C alt]]',
      '',
      '![[note]]',
    ].join('\n'),
  );

  const result = await parseMarkdown(markdownPath, { tempDir });

  assert.deepEqual(
    result.contentImages.map(({ originalPath, alt, localPath }) => ({
      originalPath,
      alt,
      localPath,
    })),
    [
      {
        originalPath: 'a.png',
        alt: '',
        localPath: path.join(articleDir, 'a.png'),
      },
      {
        originalPath: 'b.jpg',
        alt: 'B alt',
        localPath: path.join(articleDir, 'b.jpg'),
      },
      {
        originalPath: 'c.webp',
        alt: 'C alt',
        localPath: path.join(attachmentsDir, 'c.webp'),
      },
    ],
  );
  assert.match(result.contentImages[0]?.placeholder ?? '', /^BS_[A-F0-9]{16}_IMG_1$/);
  assert.match(result.contentImages[1]?.placeholder ?? '', /^BS_[A-F0-9]{16}_IMG_2$/);
  assert.match(result.contentImages[2]?.placeholder ?? '', /^BS_[A-F0-9]{16}_IMG_3$/);
  const imageNamespace = result.contentImages[0]!.placeholder.replace(/IMG_1$/, '');
  assert.match(result.html, new RegExp(`${imageNamespace}IMG_1[\\s\\S]*${imageNamespace}IMG_2[\\s\\S]*${imageNamespace}IMG_3`));
  assert.match(result.html, /!\[\[note\]\]/);
});

test('parseMarkdown resolves encoded spaces and literal percent image paths', async (t) => {
  const root = await makeTempDir('baoyu-post-to-binance-images-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const articlePath = path.join(root, 'article.md');
  const tempDir = path.join(root, 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(path.join(root, 'Pasted image.png'), 'png');
  await fs.writeFile(path.join(root, '100%.png'), 'png');
  await fs.writeFile(
    articlePath,
    [
      '# Title',
      '',
      '![encoded](Pasted%20image.png)',
      '',
      '![literal](100%.png)',
    ].join('\n'),
  );

  const result = await parseMarkdown(articlePath, { tempDir });

  assert.equal(result.contentImages[0]?.localPath, path.join(root, 'Pasted image.png'));
  assert.equal(result.contentImages[1]?.localPath, path.join(root, '100%.png'));
});

test('parseMarkdown renders CJK-adjacent bold and italics (no literal asterisks)', async (t) => {
  const root = await makeTempDir('bs-md-to-html-cjk-bold-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const markdownPath = path.join(root, 'post.md');
  const tempDir = path.join(root, 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(
    markdownPath,
    [
      '# 标题',
      '',
      '分工在变细。**国际大厂卷基础设施，中文项目卷场景落地。**这其实是生态成熟的表现。',
      '',
      '半角场景 **Top 10 里平均有 8 个** 项目。',
      '',
      '斜体 *数据来源 GitHub* 收尾。',
      '',
      '参考 **[Read the docs][d]** 了解更多。',
      '',
      '[d]: https://example.com',
    ].join('\n'),
  );

  const result = await parseMarkdown(markdownPath, { tempDir });

  assert.match(result.html, /<strong>国际大厂卷基础设施，中文项目卷场景落地。<\/strong>/);
  assert.match(result.html, /<strong>Top 10 里平均有 8 个<\/strong>/);
  assert.match(result.html, /<em>数据来源 GitHub<\/em>/);
  assert.match(result.html, /<strong><a href="https:\/\/example\.com" rel="noopener noreferrer nofollow">Read the docs<\/a><\/strong>/);
  assert.doesNotMatch(result.html, /\*\*/);
  assert.doesNotMatch(result.html, /(?<!\*)\*(?!\*)[^*\n]+\*(?!\*)/);
});

test('parseMarkdown does not decode author-written literal HTML entities into tags', async (t) => {
  const root = await makeTempDir('bs-md-to-html-entities-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const markdownPath = path.join(root, 'post.md');
  const tempDir = path.join(root, 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(
    markdownPath,
    [
      '# 标题',
      '',
      '正文中写 &#x3C;b&#x3E;literal&#x3C;/b&#x3E; 想显示字面标签。**加粗**收尾。',
      '',
      '代码里写 `&#x3C;b&#x3E;` 同样保留。',
    ].join('\n'),
  );

  const result = await parseMarkdown(markdownPath, { tempDir });

  assert.match(result.html, /<strong>加粗<\/strong>/);
  assert.doesNotMatch(result.html, /<b>literal<\/b>/);
  assert.match(result.html, /&lt;b&gt;literal&lt;\/b&gt;/);
});

test('parseMarkdown strips an invalid-YAML frontmatter block instead of leaking it', async (t) => {
  const root = await makeTempDir('bs-md-to-html-bad-yaml-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const markdownPath = path.join(root, 'post.md');
  const tempDir = path.join(root, 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(
    markdownPath,
    [
      '---',
      'title: Broken: unquoted colon value',
      'cover_image: also: broken',
      '---',
      '',
      '# 正文标题',
      '',
      '正文内容。',
    ].join('\n'),
  );

  const result = await parseMarkdown(markdownPath, { tempDir });

  assert.equal(result.title, '正文标题');
  assert.doesNotMatch(result.html, /title:|cover_image:/);
  assert.match(result.html, /正文内容。/);
});

test('parseMarkdown maps heading depths to the editor-supported h2/h3 levels', async (t) => {
  const root = await makeTempDir('bs-md-to-html-headings-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const markdownPath = path.join(root, 'post.md');
  const tempDir = path.join(root, 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(
    markdownPath,
    ['# Title', '', '## Two', '', '### Three', '', '#### Four', '', '##### Five'].join('\n'),
  );

  const result = await parseMarkdown(markdownPath, { tempDir });

  assert.match(result.html, /<h2>Two<\/h2>/);
  assert.match(result.html, /<h3>Three<\/h3>/);
  assert.match(result.html, /<h3>Four<\/h3>/);
  assert.match(result.html, /<h3>Five<\/h3>/);
  assert.doesNotMatch(result.html, /<h[456]>/);
});

test('parseMarkdown extracts code fences as BSCODEPH placeholders with multiCode payloads', async (t) => {
  const root = await makeTempDir('bs-md-to-html-code-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const markdownPath = path.join(root, 'post.md');
  const tempDir = path.join(root, 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(
    markdownPath,
    [
      '# Title',
      '',
      '```js',
      'const x = 1;',
      'console.log(x);',
      '```',
      '',
      'Between blocks.',
      '',
      '```',
      'plain text block',
      '```',
    ].join('\n'),
  );

  const result = await parseMarkdown(markdownPath, { tempDir });

  assert.match(result.codeBlocks[0]?.placeholder ?? '', /^BS_[A-F0-9]{16}_CODE_1$/);
  assert.match(result.codeBlocks[1]?.placeholder ?? '', /^BS_[A-F0-9]{16}_CODE_2$/);
  assert.match(result.html, new RegExp(`<p>${result.codeBlocks[0]!.placeholder}<\\/p>`));
  assert.match(result.html, new RegExp(`<p>${result.codeBlocks[1]!.placeholder}<\\/p>`));
  assert.doesNotMatch(result.html, /<blockquote>\s*<strong>\[/);
  assert.deepEqual(result.codeBlocks, [
    { placeholder: result.codeBlocks[0]!.placeholder, language: 'javascript', content: 'const x = 1;\nconsole.log(x);' },
    { placeholder: result.codeBlocks[1]!.placeholder, language: 'plaintext', content: 'plain text block' },
  ]);
});

test('parseMarkdown degrades tables to blockquote grids (editor has no table node)', async (t) => {
  const root = await makeTempDir('bs-md-to-html-table-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const markdownPath = path.join(root, 'post.md');
  const tempDir = path.join(root, 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(
    markdownPath,
    [
      '# Title',
      '',
      '| Coin | Price |',
      '|------|-------|',
      '| BTC  | **100k** |',
      '| ETH  | 5k    |',
    ].join('\n'),
  );

  const result = await parseMarkdown(markdownPath, { tempDir });

  assert.doesNotMatch(result.html, /<table|<tr|<td/);
  assert.match(result.html, /<blockquote><p><strong>Coin \| Price<\/strong><\/p><p>BTC \| <strong>100k<\/strong><\/p><p>ETH \| 5k<\/p><\/blockquote>/);
});

test('parseMarkdown converts #tags and $SYMBOLs into native editor spans', async (t) => {
  const root = await makeTempDir('bs-md-to-html-tags-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const markdownPath = path.join(root, 'post.md');
  const tempDir = path.join(root, 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(
    markdownPath,
    [
      '# Title',
      '',
      'Trending #Bitcoin and $BTC today, but not $100, a#b, or `#code`.',
      '',
      '中文话题 #比特币 上涨。',
      '',
      '[#NotATag](https://example.com/tag) stays a link label.',
    ].join('\n'),
  );

  const result = await parseMarkdown(markdownPath, { tempDir });

  assert.match(result.html, /<span data-type="hashtag" data-label="#Bitcoin" hashtag="Bitcoin">#Bitcoin<\/span>/);
  assert.match(result.html, /<span data-role="coinpair" data-key="BTC" data-label="\$BTC" hashtag="\$BTC">\$BTC<\/span>/);
  assert.match(result.html, /<span data-type="hashtag" data-label="#比特币" hashtag="比特币">#比特币<\/span>/);
  assert.match(result.html, /not \$100, a#b/);
  assert.match(result.html, /<code>#code<\/code>/);
  assert.match(result.html, /＞?<a href="https:\/\/example\.com\/tag"[^>]*>#NotATag<\/a>/);
});

test('parseMarkdown honors --no-hashtags/--no-cointags style options', async (t) => {
  const root = await makeTempDir('bs-md-to-html-tags-off-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const markdownPath = path.join(root, 'post.md');
  const tempDir = path.join(root, 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(markdownPath, ['# Title', '', 'Watch #Bitcoin and $BTC.'].join('\n'));

  const result = await parseMarkdown(markdownPath, { tempDir, hashtags: false, coinTags: false });

  assert.doesNotMatch(result.html, /data-type="hashtag"|data-role="coinpair"/);
  assert.match(result.html, /Watch #Bitcoin and \$BTC\./);
});

test('parseMarkdown keeps CJK entity handling intact when converting inline tags', async (t) => {
  const root = await makeTempDir('bs-md-to-html-tags-cjk-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const markdownPath = path.join(root, 'post.md');
  const tempDir = path.join(root, 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  // CJK-quoted bold forces remark-cjk-friendly to emit &#x...; refs in the SAME
  // text token as the tags — double-escaping them would break the emphasis fix.
  await fs.writeFile(
    markdownPath,
    ['# 标题', '', '**“引号加粗”**后接 #Bitcoin 与 $BTC。', '', '**行情**看 #Bitcoin，**继续加粗**结尾。'].join('\n'),
  );

  const result = await parseMarkdown(markdownPath, { tempDir });

  assert.match(result.html, /<strong>“引号加粗”<\/strong>/);
  assert.match(result.html, /<strong>行情<\/strong>/);
  assert.match(result.html, /<strong>继续加粗<\/strong>/);
  assert.match(result.html, /data-type="hashtag" data-label="#Bitcoin"/);
  assert.match(result.html, /data-role="coinpair" data-key="BTC"/);
  assert.doesNotMatch(result.html, /&amp;#x/);
  assert.doesNotMatch(result.html, /\*\*/);
});

test('parseMarkdown leaves image syntax inside code fences untouched', async (t) => {
  const root = await makeTempDir('bs-md-to-html-fence-img-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const articleDir = path.join(root, 'article');
  const tempDir = path.join(root, 'tmp');
  await fs.mkdir(articleDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(path.join(articleDir, 'a.png'), 'a');

  const markdownPath = path.join(articleDir, 'post.md');
  await fs.writeFile(
    markdownPath,
    [
      '# Title',
      '',
      '![real](a.png)',
      '',
      '```markdown',
      '![fake](b.png)',
      '```',
    ].join('\n'),
  );

  const result = await parseMarkdown(markdownPath, { tempDir });

  assert.equal(result.contentImages.length, 1);
  assert.equal(result.contentImages[0]?.originalPath, 'a.png');
  assert.equal(result.codeBlocks.length, 1);
  assert.equal(result.codeBlocks[0]?.content, '![fake](b.png)');
  assert.doesNotMatch(result.codeBlocks[0]?.content ?? '', /BSIMGPH/);
});

test('parseMarkdown removes unsafe link protocols while preserving the label', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'md-link-safety-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'article.md');
  await fs.writeFile(file, '[Unsafe link](javascript:alert(1)) and [safe link](https://example.com).');
  const parsed = await parseMarkdown(file);
  assert.doesNotMatch(parsed.html, /javascript:/i);
  assert.match(parsed.html, /Unsafe link/);
  assert.match(parsed.html, /href="https:\/\/example\.com"/);
});

test('parseMarkdown unquotes CJK-quoted frontmatter values', async (t) => {
  const root = await makeTempDir('bs-md-to-html-cjk-quotes-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const markdownPath = path.join(root, 'post.md');
  const tempDir = path.join(root, 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(
    markdownPath,
    [
      '---',
      'title: “中文标题”',
      '---',
      '',
      '正文内容。',
    ].join('\n'),
  );

  const result = await parseMarkdown(markdownPath, { tempDir });

  assert.equal(result.title, '中文标题');
});
