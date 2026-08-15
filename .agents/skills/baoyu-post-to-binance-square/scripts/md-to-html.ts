import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import frontMatter from 'front-matter';
import { Lexer, Marked, type RendererObject, type Tokens } from 'marked';
import { unified } from 'unified';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';

import { preprocessMermaidInMarkdown, replaceMarkdownImagesWithPlaceholders, resolveImagePath } from 'baoyu-md';
import { closeRenderer, renderMermaidToPng } from 'baoyu-chrome-cdp/mermaid';
import { createPlaceholderNamespace } from './publish-safety.js';

interface ImageInfo {
  placeholder: string;
  localPath: string;
  originalPath: string;
  blockIndex: number;
  alt?: string;
}

interface CodeBlockInfo {
  placeholder: string;
  language: string;
  content: string;
}

interface ParsedMarkdown {
  title: string;
  coverImage: string | null;
  contentImages: ImageInfo[];
  codeBlocks: CodeBlockInfo[];
  html: string;
  totalBlocks: number;
}

type FrontmatterFields = Record<string, unknown>;

function parseFrontmatter(content: string): { frontmatter: FrontmatterFields; body: string } {
  try {
    const parsed = frontMatter<FrontmatterFields>(content);
    return {
      frontmatter: parsed.attributes ?? {},
      body: parsed.body,
    };
  } catch {
    // Strip the --- block even when YAML is invalid (e.g. unquoted colons in values)
    const stripped = content.replace(/^---[\s\S]*?---\n?/, '');
    return { frontmatter: {}, body: stripped };
  }
}

function stripWrappingQuotes(value: string): string {
  if (!value) return value;
  const doubleQuoted = value.startsWith('"') && value.endsWith('"');
  const singleQuoted = value.startsWith("'") && value.endsWith("'");
  const cjkDoubleQuoted = value.startsWith('“') && value.endsWith('”');
  const cjkSingleQuoted = value.startsWith('‘') && value.endsWith('’');
  if (doubleQuoted || singleQuoted || cjkDoubleQuoted || cjkSingleQuoted) {
    return value.slice(1, -1).trim();
  }
  return value.trim();
}

function toFrontmatterString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return stripWrappingQuotes(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function getFrontmatterValue(frontmatter: FrontmatterFields, key: string): unknown {
  const entries = Object.entries(frontmatter);
  const found = entries.find(([k]) => k === key);
  return found ? found[1] : undefined;
}

function pickFirstString(frontmatter: FrontmatterFields, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = toFrontmatterString(getFrontmatterValue(frontmatter, key));
    if (value) return value;
  }
  return undefined;
}

function fileExists(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function directoryExists(dirPath: string): boolean {
  try {
    const stat = fs.statSync(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function readFileAtPath(resolvedPath: string): string {
  return fs.readFileSync(resolvedPath, 'utf-8');
}

function listDirEntries(resolvedPath: string): string[] {
  return fs.readdirSync(resolvedPath);
}

function containsWholeWord(haystack: string, word: string): boolean {
  if (!haystack.includes(word)) return false;
  const idx = haystack.indexOf(word);
  const charBefore = haystack.charAt(idx - 1);
  const charAfter = haystack.charAt(idx + word.length);
  const before = idx === 0 || !/\w/.test(charBefore);
  const after = idx + word.length >= haystack.length || !/\w/.test(charAfter);
  return before && after;
}

function findCoverImageNearMarkdown(baseDir: string): string | null {
  const resolvedBase = path.resolve(path.normalize(baseDir));
  const candidateDirs = [resolvedBase, path.join(resolvedBase, 'imgs')];
  const coverPattern = /^cover\.(png|jpe?g|webp)$/i;

  for (const dir of candidateDirs) {
    try {
      if (!directoryExists(dir)) continue;
      const match = listDirEntries(dir).find((entry) => coverPattern.test(entry));
      if (match) {
        return path.join(dir, match);
      }
    } catch {
      continue;
    }
  }

  return null;
}

function findNumberedImages(imgsDir: string): string[] {
  const resolvedDir = path.resolve(path.normalize(imgsDir));
  if (!directoryExists(resolvedDir)) return [];
  return listDirEntries(resolvedDir)
    .filter((f) => /^\d+\.(png|jpe?g|webp|gif)$/i.test(f))
    .sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      return na - nb;
    })
    .map((f) => path.join(resolvedDir, f));
}

function injectImagesAfterH2(body: string, imagePaths: string[]): string {
  if (imagePaths.length === 0) return body;
  const lines = body.split('\n');
  const result: string[] = [];
  let imgIdx = 0;
  for (const line of lines) {
    result.push(line);
    if (line.startsWith('## ') && imgIdx < imagePaths.length) {
      const imgPath = imagePaths.at(imgIdx++) ?? '';
      result.push('');
      result.push('![](' + imgPath + ')');
      result.push('');
    }
  }
  return result.join('\n');
}

function extractTitleFromMarkdown(markdown: string): string {
  const tokens = Lexer.lex(markdown, { gfm: true, breaks: true });
  let firstH2 = '';
  for (const token of tokens) {
    if (token.type === 'heading') {
      if (token.depth === 1) return stripWrappingQuotes(token.text);
      if (token.depth === 2 && !firstH2) firstH2 = stripWrappingQuotes(token.text);
    }
  }
  return firstH2;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeLinkHref(href: string): boolean {
  const value = href.trim();
  if (!value || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  if (/^(?:https?:|mailto:)/iu.test(value)) return true;
  return value.startsWith('#') || (/^\/(?!\/)/u.test(value));
}

// Escapes text for HTML while keeping existing &#x...;/&name; character
// references intact (decoding or double-escaping them would break the
// CJK-adjacent emphasis fix from preprocessCjkMarkdown).
function escapeTextPreservingEntities(text: string): string {
  return text
    .replace(/&(?!(?:#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Binance Square's TipTap schema has native hashtag and coinpair inline nodes.
// These spans match the editor's canonical serialization exactly — anything
// else fails to parse or crashes the node view (label must arrive via data-label).
const HASHTAG_RE = /(^|[^\p{L}\p{N}_&#])#([\p{L}\p{N}_]{1,60})(?![\p{L}\p{N}_])/gu;
const COINTAG_RE = /(^|[^\p{L}\p{N}_$])\$([A-Z][A-Z0-9]{1,9})(?![\p{L}\p{N}])/gu;

interface InlineTagOptions {
  hashtags: boolean;
  coinTags: boolean;
}

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  golang: 'go',
  'c++': 'cpp',
  'c#': 'csharp',
};

function linkifyInlineTags(text: string, opts: InlineTagOptions): string | null {
  if (!text) return null;
  const hasHash = opts.hashtags && /#[\p{L}\p{N}_]/u.test(text);
  const hasCoin = opts.coinTags && /\$[A-Z]/.test(text);
  if (!hasHash && !hasCoin) return null;
  let out = escapeTextPreservingEntities(text);
  let changed = false;
  if (hasHash) {
    out = out.replace(HASHTAG_RE, (_m, pre: string, tag: string) => {
      changed = true;
      return pre + '<span data-type="hashtag" data-label="#' + tag + '" hashtag="' + tag + '">#' + tag + '</span>';
    });
  }
  if (hasCoin) {
    out = out.replace(COINTAG_RE, (_m, pre: string, sym: string) => {
      changed = true;
      return pre + '<span data-role="coinpair" data-key="' + sym + '" data-label="$' + sym + '" hashtag="$' + sym + '">$' + sym + '</span>';
    });
  }
  return changed ? out : null;
}

// Walks the lexed token tree and rewrites leaf text tokens containing #tags or
// $SYMBOLs into raw-html tokens with native editor spans. Skips link labels,
// code spans, and code blocks so their contents stay literal.
const SKIP_INLINE_TYPES = new Set(['link', 'codespan', 'code', 'image']);

function convertInlineTags(tokens: unknown[], opts: InlineTagOptions): void {
  for (const raw of tokens) {
    const token = raw as Record<string, unknown> & { type?: string };
    if (!token || SKIP_INLINE_TYPES.has(token.type ?? '')) continue;
    const children = token.tokens as unknown[] | undefined;
    if (token.type === 'text' && !children) {
      const converted = linkifyInlineTags(String(token.text ?? ''), opts);
      if (converted !== null) {
        token.type = 'html';
        token.text = converted;
        token.pre = false;
        token.block = false;
      }
      continue;
    }
    if (children) convertInlineTags(children, opts);
    const items = token.items as unknown[] | undefined;
    if (items) convertInlineTags(items, opts);
    if (token.type === 'table') {
      const header = token.header as Array<{ tokens?: unknown[] }> | undefined;
      const rows = token.rows as Array<Array<{ tokens?: unknown[] }>> | undefined;
      for (const cell of header ?? []) if (cell?.tokens) convertInlineTags(cell.tokens, opts);
      for (const row of rows ?? []) for (const cell of row ?? []) if (cell?.tokens) convertInlineTags(cell.tokens, opts);
    }
  }
}

// Fenced code blocks must be invisible to replaceMarkdownImagesWithPlaceholders
// (which scans raw markdown) — otherwise image syntax inside a fence is rewritten
// into an image placeholder, corrupting the user's literal code.
function maskFencedBlocks(markdown: string, namespace: string): { masked: string; blocks: Map<string, string> } {
  const lines = markdown.split('\n');
  const out: string[] = [];
  const blocks = new Map<string, string>();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const open = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (open) {
      const fenceChar = open[1]![0]!;
      const fenceLen = open[1]!.length;
      const closeRe = new RegExp('^\\s{0,3}' + fenceChar + '{' + fenceLen + ',}\\s*$');
      let j = i + 1;
      while (j < lines.length && !closeRe.test(lines[j]!)) j++;
      const end = j < lines.length ? j : lines.length - 1;
      const key = `${namespace}FENCE_${blocks.size + 1}`;
      blocks.set(key, lines.slice(i, end + 1).join('\n'));
      out.push(key);
      i = end + 1;
      continue;
    }
    out.push(line);
    i++;
  }
  return { masked: out.join('\n'), blocks };
}

function restoreFencedBlocks(markdown: string, blocks: Map<string, string>): string {
  let out = markdown;
  for (const [key, block] of blocks) {
    out = out.replace(key, () => block);
  }
  return out;
}

// remark-stringify emits CJK boundary chars around emphasis as &#x...; character
// references so `marked` can parse **bold** adjacent to CJK. Decoding them here
// would reintroduce the literal-asterisk bug; consumers that match rendered text
// against the live editor must decode entities on their side instead.
function preprocessCjkMarkdown(markdown: string): string {
  try {
    const processor = unified()
      .use(remarkParse)
      .use(remarkCjkFriendly)
      .use(remarkStringify);

    return String(processor.processSync(markdown));
  } catch {
    return markdown;
  }
}

function convertMarkdownToHtml(
  markdown: string,
  options?: { hashtags?: boolean; coinTags?: boolean; placeholderNamespace?: string },
): { html: string; totalBlocks: number; codeBlocks: CodeBlockInfo[] } {
  const inlineTagOptions: InlineTagOptions = {
    hashtags: options?.hashtags ?? true,
    coinTags: options?.coinTags ?? true,
  };
  const preprocessedMarkdown = preprocessCjkMarkdown(markdown);
  const codeBlocks: CodeBlockInfo[] = [];

  const renderer: RendererObject = {
    // The editor's heading node only supports levels 2 and 3 (verified against
    // the live TipTap schema); H4+ would silently degrade to paragraphs.
    heading({ depth, tokens }: Tokens.Heading): string {
      if (depth === 1) {
        return '';
      }
      const tag = depth === 2 ? 'h2' : 'h3';
      // nosec: intentional HTML output from trusted markdown renderer
      return '<' + tag + '>' + this.parser.parseInline(tokens) + '</' + tag + '>';
    },

    paragraph({ tokens }: Tokens.Paragraph): string {
      const text = this.parser.parseInline(tokens).trim();
      if (!text) return '';
      // nosec: intentional HTML output from trusted markdown renderer
      return '<p>' + text + '</p>';
    },

    blockquote({ tokens }: Tokens.Blockquote): string {
      // nosec: intentional HTML output from trusted markdown renderer
      return '<blockquote>' + this.parser.parse(tokens) + '</blockquote>';
    },

    // Code fences become namespaced placeholder paragraphs; binance-article.ts
    // replaces them with native multiCode nodes via TipTap insertContentAt
    // (multiCode's `blocks` attr cannot round-trip through HTML — it parses as
    // a string instead of an array).
    code({ text, lang = '' }: Tokens.Code): string {
      const rawLang = (lang.split(/\s+/)[0] ?? '').toLowerCase();
      const language = LANG_ALIASES[rawLang] ?? rawLang ?? '';
      const source = text.replace(/\n$/, '');
      const placeholder = `${options?.placeholderNamespace ?? 'BS_FALLBACK_'}CODE_${codeBlocks.length + 1}`;
      codeBlocks.push({ placeholder, language: language || 'plaintext', content: source });
      return '<p>' + placeholder + '</p>';
    },

    // The editor schema has tableRow/tableCell nodes but NO parent table node
    // (PresetKit table:false) — raw <table> HTML collapses into one concatenated
    // paragraph. Degrade to a blockquote grid that survives setContent intact.
    table(token: Tokens.Table): string {
      const renderCells = (cells: Tokens.TableCell[]): string =>
        cells.map((cell) => this.parser.parseInline(cell.tokens).trim()).join(' | ');
      const header = renderCells(token.header);
      const rows = token.rows.map((row) => '<p>' + renderCells(row) + '</p>').join('');
      // nosec: intentional HTML output from trusted markdown renderer
      return '<blockquote><p><strong>' + header + '</strong></p>' + rows + '</blockquote>';
    },

    image({ href, text }: Tokens.Image): string {
      if (!href) return '';
      return escapeHtml(text ?? '');
    },

    link({ href, title, tokens, text }: Tokens.Link): string {
      const label = tokens?.length ? this.parser.parseInline(tokens) : escapeHtml(text || href || '');
      if (!href) return label;

      const plainLabel = label.replace(/<[^>]*>/g, '').trim();
      if (/^[a-z][a-z0-9._-]*$/.test(plainLabel)) return '';
      if (!isSafeLinkHref(href)) return label;

      const titleAttr = title ? ' title="' + escapeHtml(title) + '"' : '';
      // nosec: href and title are HTML-escaped; label comes from the trusted renderer
      return '<a href="' + escapeHtml(href) + '"' + titleAttr + ' rel="noopener noreferrer nofollow">' + label + '</a>';
    },
  };

  const parser = new Marked({
    gfm: true,
    breaks: true,
  });
  parser.use({ renderer });

  const blockTokens = parser.lexer(preprocessedMarkdown);
  if (inlineTagOptions.hashtags || inlineTagOptions.coinTags) {
    convertInlineTags(blockTokens, inlineTagOptions);
  }
  const rendered = parser.parser(blockTokens);
  if (typeof rendered !== 'string') {
    throw new Error('Unexpected async markdown parse result');
  }

  const totalBlocks = blockTokens.filter((token) => {
    if (token.type === 'space') return false;
    if (token.type === 'heading' && token.depth === 1) return false;
    return true;
  }).length;

  return {
    html: rendered,
    totalBlocks,
    codeBlocks,
  };
}

export async function parseMarkdown(
  markdownPath: string,
  options?: {
    coverImage?: string;
    title?: string;
    tempDir?: string;
    hashtags?: boolean;
    coinTags?: boolean;
    inferCoverFromFirstImage?: boolean;
  },
): Promise<ParsedMarkdown> {
  const resolvedMarkdownPath = path.resolve(path.normalize(markdownPath));
  const content = readFileAtPath(resolvedMarkdownPath);
  const baseDir = path.dirname(resolvedMarkdownPath);
  const tempDir = options?.tempDir ?? path.join(os.tmpdir(), 'bs-article-images');

  await mkdir(tempDir, { recursive: true });

  const { frontmatter, body } = parseFrontmatter(content);

  // A random namespace prevents a user's literal placeholder-looking text from
  // being mistaken for an automation token during image/code replacement.
  let placeholderNamespace = '';
  do {
    placeholderNamespace = createPlaceholderNamespace();
  } while (body.includes(placeholderNamespace));

  let title = stripWrappingQuotes(options?.title ?? '') || pickFirstString(frontmatter, ['title']) || '';
  if (!title) {
    title = extractTitleFromMarkdown(body);
  }
  if (!title) {
    title = path.basename(markdownPath, path.extname(markdownPath));
  }

  const allowImplicitCover = options?.inferCoverFromFirstImage !== false;
  let coverImagePath = stripWrappingQuotes(options?.coverImage ?? '') || null;
  if (!coverImagePath && allowImplicitCover) {
    coverImagePath = pickFirstString(frontmatter, [
      'cover_image',
      'coverImage',
      'cover',
      'image',
      'featureImage',
      'feature_image',
    ]) || null;
  }
  if (!coverImagePath && allowImplicitCover) {
    coverImagePath = findCoverImageNearMarkdown(baseDir);
  }

  const hasInlineImages = /!\[.*?\]\(.*?\)/.test(body);
  const numberedImgPaths = findNumberedImages(path.join(baseDir, 'imgs')).map((p) =>
    path.relative(baseDir, p),
  );
  const injectedBody = hasInlineImages
    ? body
    : injectImagesAfterH2(body, numberedImgPaths);

  const { markdown: mermaidProcessedBody, images: mermaidImages } =
    await preprocessMermaidInMarkdown(injectedBody, {
      baseDir,
      renderFn: async (code, outputPath, opts) => { await renderMermaidToPng(code, outputPath, opts); },
      onError: (error, block) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[md-to-html] mermaid render failed (${block.code.slice(0, 40).replace(/\s+/g, ' ')}…): ${message}`,
        );
      },
    });

  if (mermaidImages.length > 0) {
    const fresh = mermaidImages.filter((image) => !image.cached).length;
    console.error(
      `[md-to-html] mermaid: ${mermaidImages.length} block(s), ${fresh} rendered, ${mermaidImages.length - fresh} cached`,
    );
  }

  const { masked, blocks: fenceBlocks } = maskFencedBlocks(mermaidProcessedBody, placeholderNamespace);
  const { images, markdown: rewrittenBody } = replaceMarkdownImagesWithPlaceholders(
    masked,
    `${placeholderNamespace}IMG_`,
  );
  const restoredBody = restoreFencedBlocks(rewrittenBody, fenceBlocks);
  const { html, totalBlocks, codeBlocks } = convertMarkdownToHtml(restoredBody, {
    hashtags: options?.hashtags,
    coinTags: options?.coinTags,
    placeholderNamespace,
  });

  const htmlLines = html.split('\n');
  const imageBlockIndexes = new Map<string, number>();
  for (const img of images) {
    const ph = img.placeholder;
    let lineIndex = 0;
    for (const line of htmlLines) {
      if (containsWholeWord(line, ph)) {
        imageBlockIndexes.set(ph, lineIndex);
        break;
      }
      lineIndex++;
    }
  }

  const contentImages: ImageInfo[] = [];
  let firstImageAsCover: string | null = null;

  let isFirst = true;
  for (const img of images) {
    const localPath = await resolveImagePath(img.originalPath, baseDir, tempDir, 'md-to-html');

    if (isFirst && !coverImagePath && allowImplicitCover) {
      firstImageAsCover = localPath;
    }
    isFirst = false;

    contentImages.push({
      placeholder: img.placeholder,
      localPath,
      originalPath: img.originalPath,
      alt: img.alt,
      blockIndex: imageBlockIndexes.get(img.placeholder) ?? -1,
    });
  }

  const finalHtml = html.replace(/\n{3,}/g, '\n\n').trim();

  let resolvedCoverImage: string | null = null;
  if (coverImagePath) {
    resolvedCoverImage = await resolveImagePath(coverImagePath, baseDir, tempDir, 'md-to-html');
  } else if (firstImageAsCover) {
    resolvedCoverImage = firstImageAsCover;
  }

  return {
    title,
    coverImage: resolvedCoverImage,
    contentImages,
    codeBlocks,
    html: finalHtml,
    totalBlocks,
  };
}

function printUsage(): never {
  console.log(`Convert Markdown to HTML for Binance Square article publishing

Usage:
  npx -y bun md-to-html.ts <markdown_file> [options]

Options:
  --title <title>       Override title from frontmatter
  --cover <image>       Override cover image from frontmatter
  --output <json|html>  Output format (default: json)
  --html-only           Output only the HTML content
  --save-html <path>    Save HTML to file
  --no-hashtags         Keep #tags as plain text (skip native hashtag nodes)
  --no-cointags         Keep $SYMBOLs as plain text (skip native coinpair nodes)

Frontmatter fields:
  title: Article title (or use first H1)
  cover_image: Cover image path or URL
  cover: Alias for cover_image
  image: Alias for cover_image

Example:
  npx -y bun md-to-html.ts article.md --output json
  npx -y bun md-to-html.ts article.md --html-only > /tmp/article.html
  npx -y bun md-to-html.ts article.md --save-html /tmp/article.html
`);
  process.exit(0);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
  }

  let markdownPath: string | undefined;
  let title: string | undefined;
  let coverImage: string | undefined;
  let outputFormat = 'json';
  let htmlOnly = false;
  let saveHtmlPath: string | undefined;
  let hashtags = true;
  let coinTags = true;

  const argPairs = args.flatMap((a, idx) => ([
    { flag: a, next: args.at(idx + 1) },
  ] as Array<{ flag: string; next: string | undefined }>));
  const consumed = new Set<number>();
  args.forEach((arg, idx) => {
    if (consumed.has(idx)) return;
    if (arg === '--title' && idx + 1 < args.length) {
      consumed.add(idx + 1);
      title = argPairs.at(idx)?.next;
    } else if (arg === '--cover' && idx + 1 < args.length) {
      consumed.add(idx + 1);
      coverImage = argPairs.at(idx)?.next;
    } else if (arg === '--output' && idx + 1 < args.length) {
      consumed.add(idx + 1);
      const fmt = argPairs.at(idx)?.next ?? '';
      outputFormat = fmt === 'html' ? 'html' : 'json';
    } else if (arg === '--html-only') {
      htmlOnly = true;
    } else if (arg === '--no-hashtags') {
      hashtags = false;
    } else if (arg === '--no-cointags') {
      coinTags = false;
    } else if (arg === '--save-html' && idx + 1 < args.length) {
      consumed.add(idx + 1);
      saveHtmlPath = argPairs.at(idx)?.next;
    } else if (!arg.startsWith('-')) {
      markdownPath = arg;
    }
  });

  if (!markdownPath) {
    console.error('Error: Markdown file path required');
    process.exit(1);
  }

  const resolvedInput = path.resolve(path.normalize(markdownPath));
  if (!fileExists(resolvedInput)) {
    console.error('Error: File not found: ' + resolvedInput);
    process.exit(1);
  }
  markdownPath = resolvedInput;

  const result = await parseMarkdown(markdownPath, { title, coverImage, hashtags, coinTags });

  if (saveHtmlPath) {
    await writeFile(saveHtmlPath, result.html, 'utf-8');
    console.error(`[md-to-html] HTML saved to: ${saveHtmlPath}`);
  }

  if (htmlOnly || outputFormat === 'html') {
    console.log(result.html);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await closeRenderer();
  }
}
