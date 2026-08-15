import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { parseMarkdown } from './md-to-html.js';
import {
  assertXArticleBodyMediaEvidence,
  bindXArticleMediaAsset,
  scopeXArticleBodySnapshot,
  xArticleImageFingerprintsMatch,
  type RenderedXArticleBodyToken,
  type ReviewedXArticleBodyToken,
  type XArticleImageFingerprint,
  type XArticleMediaAssetBinding,
} from './x-article-evidence.js';
import {
  CHROME_CANDIDATES_BASIC,
  CdpConnection,
  copyHtmlToClipboard,
  copyImageToClipboard,
  findChromeExecutable,
  getDefaultProfileDir,
  getFreePort,
  pasteFromClipboard,
  sleep,
  waitForChromeDebugPort,
} from './x-utils.js';

export {
  assertXArticleBodyMediaEvidence,
  bindXArticleMediaAsset,
  scopeXArticleBodySnapshot,
  xArticleImageFingerprintsMatch,
} from './x-article-evidence.js';

const X_ARTICLES_URL = 'https://x.com/compose/articles';

export function assertXArticlePublishMode(options: Pick<ArticleOptions, 'submit' | 'onComposed'>): void {
  if (options.submit && options.onComposed) {
    throw new Error('X Article submit and onComposed handoff cannot be used together.');
  }
}

function canonicalStandaloneXArticleUrl(value: string | undefined): string | null {
  return value && /^https:\/\/x\.com\/i\/article\/[0-9]+$/.test(value) ? value : null;
}

export async function submitVerifiedXArticle<TGuard>({
  assertCurrent,
  readPublicationCandidates,
  clickPublish,
  waitForPublishedUrl,
}: {
  assertCurrent: () => TGuard | Promise<TGuard>;
  readPublicationCandidates?: () => readonly string[] | Promise<readonly string[]>;
  clickPublish: (guard: TGuard) => (
    boolean
    | { clicked: boolean; baselineCandidates: readonly string[] }
    | Promise<boolean | { clicked: boolean; baselineCandidates: readonly string[] }>
  );
  waitForPublishedUrl: (
    preClickCandidates: readonly string[],
  ) => string | undefined | Promise<string | undefined>;
}): Promise<string> {
  const guard = await assertCurrent();
  const preClickCandidates = new Set(
    (await readPublicationCandidates?.() ?? [])
      .map((candidate) => canonicalStandaloneXArticleUrl(candidate))
      .filter((candidate): candidate is string => Boolean(candidate)),
  );
  const clickResult = await clickPublish(guard);
  const clicked = typeof clickResult === 'boolean' ? clickResult : clickResult.clicked;
  if (!clicked) {
    throw new Error('The scoped X Article Publish button could not be clicked.');
  }
  if (typeof clickResult !== 'boolean') {
    for (const candidate of clickResult.baselineCandidates) {
      const canonical = canonicalStandaloneXArticleUrl(candidate);
      if (canonical) preClickCandidates.add(canonical);
    }
  }
  const publishedUrl = canonicalStandaloneXArticleUrl(
    await waitForPublishedUrl([...preClickCandidates]),
  );
  if (!publishedUrl) {
    throw new Error('X did not expose canonical Article publication evidence.');
  }
  if (preClickCandidates.has(publishedUrl)) {
    throw new Error('X did not expose new canonical Article publication evidence after the click.');
  }
  return publishedUrl;
}

const I18N_SELECTORS = {
  titleInput: [
    'textarea[placeholder="Add a title"]',
    'textarea[placeholder="添加标题"]',
    'textarea[placeholder="タイトルを追加"]',
    'textarea[placeholder="제목 추가"]',
    'textarea[name="Article Title"]',
  ],
  addPhotosButton: [
    '[aria-label="Add photos or video"]',
    '[aria-label="添加照片或视频"]',
    '[aria-label="写真や動画を追加"]',
    '[aria-label="사진 또는 동영상 추가"]',
  ],
  previewButton: [
    'a[href*="/preview"]',
    '[data-testid="previewButton"]',
    'button[aria-label*="preview" i]',
    'button[aria-label*="预览" i]',
    'button[aria-label*="プレビュー" i]',
    'button[aria-label*="미리보기" i]',
  ],
  publishButton: [
    '[data-testid="publishButton"]',
    'button[aria-label*="publish" i]',
    'button[aria-label*="发布" i]',
    'button[aria-label*="公開" i]',
    'button[aria-label*="게시" i]',
  ],
};

function decodeArticleHtml(text: string): string {
  return text
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, '\u00a0')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&');
}

export function xArticleHtmlToText(html: string): string {
  return decodeArticleHtml(html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:blockquote|div|h[1-6]|li|ol|p|pre|ul)>/gi, '\n')
    .replace(/<[^>]*>/g, ''));
}

function normalizeArticleBodyText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isXArticleBodyInserted(actualText: string, expectedText: string): boolean {
  const actual = normalizeArticleBodyText(actualText);
  const expected = normalizeArticleBodyText(expectedText);
  if (!expected) return false;
  return actual === expected;
}

function renderedPlaceholderPattern(placeholder: string): RegExp {
  const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}(?!\\d)`, 'g');
}

export function deriveXArticleFinalBodyText(
  html: string,
  imagePlaceholders: readonly string[],
): string {
  let expected = xArticleHtmlToText(html);
  for (const placeholder of [...imagePlaceholders].sort((a, b) => b.length - a.length)) {
    expected = expected.replace(renderedPlaceholderPattern(placeholder), '');
  }
  return expected;
}

export async function insertXArticleBodyExactly({
  expectedText,
  clear,
  attempts,
  read,
}: {
  expectedText: string;
  clear: () => Promise<void>;
  attempts: Array<() => Promise<void>>;
  read: () => Promise<string>;
}): Promise<void> {
  let lastAttemptError: unknown;
  for (const attempt of attempts) {
    await clear();
    try {
      await attempt();
      if (isXArticleBodyInserted(await read(), expectedText)) return;
    } catch (error) {
      lastAttemptError = error;
    }
  }
  const detail = lastAttemptError instanceof Error ? ` Last attempt: ${lastAttemptError.message}` : '';
  throw new Error(`X Article body insertion failed: no attempt produced the exact reviewed body.${detail}`);
}

export async function waitForXArticleBodyCleared({
  read,
  readMediaCount,
  wait,
  maxChecks,
}: {
  read: () => Promise<string>;
  readMediaCount?: () => Promise<number>;
  wait: () => Promise<void>;
  maxChecks: number;
}): Promise<void> {
  let consecutiveEmptyChecks = 0;
  for (let check = 0; check < maxChecks; check++) {
    const textEmpty = normalizeArticleBodyText(await read()) === '';
    const mediaEmpty = !readMediaCount || await readMediaCount() === 0;
    if (textEmpty && mediaEmpty) {
      consecutiveEmptyChecks += 1;
      if (consecutiveEmptyChecks >= 2) return;
    } else {
      consecutiveEmptyChecks = 0;
    }
    if (check + 1 < maxChecks) await wait();
  }
  throw new Error('The X Article body editor did not clear to a stable empty state.');
}

const X_ARTICLE_IMAGE_FINGERPRINT_BROWSER_SOURCE = String.raw`
async function xArticleImageFingerprint(image) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sourceBefore = image.currentSrc || image.src || '';
    if (!sourceBefore) throw new Error('X Article media has no readable source.');
    if (!image.complete || !image.naturalWidth || !image.naturalHeight) await image.decode();
    const sourceAfter = image.currentSrc || image.src || '';
    if (sourceAfter !== sourceBefore) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error('X Article media did not decode to nonzero dimensions.');
    }

    const differenceCanvas = document.createElement('canvas');
    differenceCanvas.width = 33;
    differenceCanvas.height = 32;
    const differenceContext = differenceCanvas.getContext('2d', { willReadFrequently: true });
    if (!differenceContext) throw new Error('X Article media fingerprint canvas is unavailable.');
    differenceContext.drawImage(image, 0, 0, 33, 32);
    const differencePixels = differenceContext.getImageData(0, 0, 33, 32).data;
    const bits = [];
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        const left = (y * 33 + x) * 4;
        const right = left + 4;
        const leftLuma = differencePixels[left] * 299
          + differencePixels[left + 1] * 587 + differencePixels[left + 2] * 114;
        const rightLuma = differencePixels[right] * 299
          + differencePixels[right + 1] * 587 + differencePixels[right + 2] * 114;
        bits.push(leftLuma >= rightLuma ? 1 : 0);
      }
    }
    let differenceHash = '';
    for (let index = 0; index < bits.length; index += 4) {
      differenceHash += ((bits[index] << 3) | (bits[index + 1] << 2)
        | (bits[index + 2] << 1) | bits[index + 3]).toString(16);
    }

    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = 16;
    colorCanvas.height = 16;
    const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
    if (!colorContext) throw new Error('X Article media color fingerprint canvas is unavailable.');
    colorContext.drawImage(image, 0, 0, 16, 16);
    const colorPixels = colorContext.getImageData(0, 0, 16, 16).data;
    const colorSamples = [];
    const alphaSamples = [];
    for (let index = 0; index < colorPixels.length; index += 4) {
      colorSamples.push(colorPixels[index], colorPixels[index + 1], colorPixels[index + 2]);
      alphaSamples.push(colorPixels[index + 3]);
    }
    return {
      aspectRatio: image.naturalWidth / image.naturalHeight,
      differenceHash,
      colorSamples,
      alphaSamples,
    };
  }
  throw new Error('X Article media source changed repeatedly while fingerprinting.');
}`;

const X_ARTICLE_IMAGE_FINGERPRINT_MATCH_BROWSER_SOURCE = String.raw`
function xArticleImageFingerprintsMatch(expected, actual) {
  const fingerprints = [expected, actual];
  if (fingerprints.some((fingerprint) => (
    !fingerprint || !Number.isFinite(fingerprint.aspectRatio)
    || fingerprint.aspectRatio <= 0
    || !/^[a-f0-9]+$/i.test(fingerprint.differenceHash)
    || fingerprint.differenceHash.length < 16
    || fingerprint.differenceHash.length !== expected.differenceHash.length
    || fingerprint.colorSamples.length === 0
    || fingerprint.colorSamples.length !== expected.colorSamples.length
    || fingerprint.colorSamples.some(
      (sample) => !Number.isInteger(sample) || sample < 0 || sample > 255
    )
    || (fingerprint.alphaSamples !== undefined && (
      fingerprint.alphaSamples.length === 0
      || fingerprint.alphaSamples.some(
        (sample) => !Number.isInteger(sample) || sample < 0 || sample > 255
      )
    ))
  ))) return false;
  if ((expected.alphaSamples === undefined) !== (actual.alphaSamples === undefined)) return false;
  if (
    expected.alphaSamples
    && actual.alphaSamples
    && expected.alphaSamples.length !== actual.alphaSamples.length
  ) return false;

  const ratioDelta = Math.abs(expected.aspectRatio - actual.aspectRatio)
    / Math.max(expected.aspectRatio, actual.aspectRatio);
  if (ratioDelta > 0.01) return false;

  let differingBits = 0;
  for (let index = 0; index < expected.differenceHash.length; index++) {
    const xor = Number.parseInt(expected.differenceHash[index], 16)
      ^ Number.parseInt(actual.differenceHash[index], 16);
    differingBits += xor.toString(2).replace(/0/g, '').length;
  }
  const bitCount = expected.differenceHash.length * 4;
  if (differingBits > Math.max(2, Math.floor(bitCount * 0.02))) return false;

  let absoluteColorDelta = 0;
  let largeColorDeltas = 0;
  for (let index = 0; index < expected.colorSamples.length; index++) {
    const delta = Math.abs(expected.colorSamples[index] - actual.colorSamples[index]);
    absoluteColorDelta += delta;
    if (delta > 16) largeColorDeltas += 1;
  }
  if (
    absoluteColorDelta / expected.colorSamples.length > 4
    || largeColorDeltas / expected.colorSamples.length > 0.02
  ) return false;

  if (expected.alphaSamples && actual.alphaSamples) {
    let absoluteAlphaDelta = 0;
    let largeAlphaDeltas = 0;
    for (let index = 0; index < expected.alphaSamples.length; index++) {
      const delta = Math.abs(expected.alphaSamples[index] - actual.alphaSamples[index]);
      absoluteAlphaDelta += delta;
      if (delta > 16) largeAlphaDeltas += 1;
    }
    if (
      absoluteAlphaDelta / expected.alphaSamples.length > 4
      || largeAlphaDeltas / expected.alphaSamples.length > 0.02
    ) return false;
  }
  return true;
}`;

const X_ARTICLE_PUBLICATION_CANDIDATES_BROWSER_SOURCE = String.raw`
function xArticlePublicationCandidates() {
  const canonicalPattern = new RegExp('^https://x[.]com/i/article/[0-9]+$');
  const values = [window.location.href];
  for (const root of document.querySelectorAll(
    '[role="status"], [data-testid="toast"], [data-testid*="toast" i]'
  )) {
    for (const link of root.querySelectorAll('a[href]')) {
      const rawHref = link.getAttribute('href');
      if (rawHref) values.push(rawHref);
    }
  }
  return Array.from(new Set(values.filter(
    (value) => typeof value === 'string' && canonicalPattern.test(value)
  )));
}`;

export interface XArticleEditorSnapshot {
  url: string;
  editorId: string;
  title: string;
  body: string;
  bodySequence: RenderedXArticleBodyToken[];
  mediaSources: string[];
  coverSources: string[];
  coverMedia: Array<{ source: string; fingerprint: XArticleImageFingerprint }>;
  editorVisible: boolean;
  publishButtonCount: number;
  publishButtonEnabled: boolean;
}

export async function readXArticleEditorSnapshot(
  cdp: Pick<CdpConnection, 'send'>,
  sessionId: string,
): Promise<XArticleEditorSnapshot> {
  const result = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
    expression: `(async () => {
      ${X_ARTICLE_IMAGE_FINGERPRINT_BROWSER_SOURCE}
      const visible = (element) => {
        if (!element || element.closest('[role="dialog"][aria-modal="true"]')) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const unique = (values) => Array.from(new Set(values));
      const titleElements = unique(${JSON.stringify(I18N_SELECTORS.titleInput)}
        .flatMap((selector) => Array.from(document.querySelectorAll(selector))))
        .filter(visible);
      const bodyElements = Array.from(document.querySelectorAll(
        '.DraftEditor-editorContainer [data-contents="true"]'
      )).filter(visible);
      if (titleElements.length !== 1 || bodyElements.length !== 1) {
        return JSON.stringify({ error: 'The X Article editor root is missing or ambiguous.' });
      }
      const title = titleElements[0];
      const body = bodyElements[0];
      let editorRoot = title.closest('main, [role="main"], form');
      if (!editorRoot || !editorRoot.contains(body)) {
        editorRoot = title.parentElement;
        while (editorRoot && !editorRoot.contains(body)) editorRoot = editorRoot.parentElement;
      }
      if (!editorRoot) return JSON.stringify({ error: 'The X Article editor root could not be scoped.' });

      const allBlocks = Array.from(body.querySelectorAll('[data-block="true"]'))
        .filter((block) => !block.parentElement?.closest('[data-block="true"]'));
      const blockOwnerIds = allBlocks.map((block) => block.getAttribute('data-editor'));
      if (blockOwnerIds.some((ownerEditorId) => !ownerEditorId)) {
        return JSON.stringify({ error: 'The X Article body contains an ownerless or unaccounted editor block.' });
      }
      const editorIds = unique(blockOwnerIds);
      if (editorIds.length !== 1) {
        return JSON.stringify({ error: 'The X Article DraftJS editor identity is missing or ambiguous.' });
      }
      const editorId = editorIds[0];
      const blocks = allBlocks.filter((block) => block.getAttribute('data-editor') === editorId);
      const bodySequence = [];
      const mediaSources = [];
      const mediaBlockIds = new Set();
      const accountedBodyImages = new Set();
      for (const block of blocks) {
        const images = Array.from(block.querySelectorAll('img')).filter(visible);
        const text = block.innerText || block.textContent || '';
        if (images.length > 0) {
          if (images.length !== 1 || text.replace(/\\s+/g, ' ').trim()) {
            return JSON.stringify({ error: 'The X Article contains an ambiguous mixed media block.' });
          }
          const offsetKey = block.getAttribute('data-offset-key')
            || block.querySelector('[data-offset-key]')?.getAttribute('data-offset-key') || '';
          const keyMatch = offsetKey.match(/^(.+)-\\d+-\\d+$/);
          const blockId = keyMatch?.[1] || '';
          if (!blockId || mediaBlockIds.has(blockId)) {
            return JSON.stringify({ error: 'The X Article media block identity is missing or duplicated.' });
          }
          mediaBlockIds.add(blockId);
          try {
            const image = images[0];
            accountedBodyImages.add(image);
            const source = image.currentSrc || image.src || '';
            const fingerprint = await xArticleImageFingerprint(image);
            bodySequence.push({ kind: 'media', blockId, source, fingerprint });
            mediaSources.push(source);
          } catch (error) {
            return JSON.stringify({
              error: error instanceof Error ? error.message : 'X Article media fingerprinting failed.',
            });
          }
        } else if (text.replace(/\\s+/g, ' ').trim()) {
          bodySequence.push({ kind: 'text', text });
        }
      }
      const visibleBodyImages = Array.from(body.querySelectorAll('img')).filter(visible);
      if (
        visibleBodyImages.length !== accountedBodyImages.size
        || visibleBodyImages.some((image) => !accountedBodyImages.has(image))
      ) {
        return JSON.stringify({ error: 'The X Article body contains ownerless or unaccounted media.' });
      }

      const coverImages = Array.from(editorRoot.querySelectorAll(
        '[data-testid*="cover" i] img, [data-testid*="headerMedia" i] img'
      )).filter(visible);
      const coverMedia = [];
      for (const image of coverImages) {
        const source = image.currentSrc || image.src || '';
        if (!source) continue;
        try {
          coverMedia.push({ source, fingerprint: await xArticleImageFingerprint(image) });
        } catch (error) {
          return JSON.stringify({
            error: error instanceof Error ? error.message : 'X Article cover fingerprinting failed.',
          });
        }
      }
      const coverSources = coverMedia.map((item) => item.source);
      const publishButtons = unique(${JSON.stringify(I18N_SELECTORS.publishButton)}
        .flatMap((selector) => Array.from(editorRoot.querySelectorAll(selector))))
        .filter(visible);
      const publishButton = publishButtons.length === 1 ? publishButtons[0] : null;
      return JSON.stringify({ snapshot: {
        url: window.location.href,
        editorId,
        title: title.value || title.innerText || title.textContent || '',
        body: body.innerText || body.textContent || '',
        bodySequence,
        mediaSources,
        coverSources,
        coverMedia,
        editorVisible: true,
        publishButtonCount: publishButtons.length,
        publishButtonEnabled: Boolean(publishButton && !publishButton.disabled
          && publishButton.getAttribute('aria-disabled') !== 'true'),
      } });
    })()`,
    awaitPromise: true,
    returnByValue: true,
  }, { sessionId });
  const parsed = JSON.parse(result.result.value) as {
    error?: string;
    snapshot?: XArticleEditorSnapshot;
  };
  if (!parsed.snapshot) throw new Error(parsed.error ?? 'The X Article editor snapshot is unavailable.');
  return parsed.snapshot;
}

export async function readXArticlePublicationCandidates(
  cdp: Pick<CdpConnection, 'send'>,
  sessionId: string,
): Promise<string[]> {
  const result = await cdp.send<{ result: { value: string[] } }>('Runtime.evaluate', {
    expression: `(() => {
      ${X_ARTICLE_PUBLICATION_CANDIDATES_BROWSER_SOURCE}
      return xArticlePublicationCandidates();
    })()`,
    returnByValue: true,
  }, { sessionId });
  return result.result.value;
}

async function clickGuardedXArticlePublish({
  cdp,
  sessionId,
  guard,
}: {
  cdp: Pick<CdpConnection, 'send'>;
  sessionId: string;
  guard: XArticleEditorSnapshot;
}): Promise<boolean | { clicked: true; baselineCandidates: string[] }> {
  const result = await cdp.send<{
    result: { value: boolean | { clicked: true; baselineCandidates: string[] } };
  }>('Runtime.evaluate', {
    expression: `(async () => {
      ${X_ARTICLE_IMAGE_FINGERPRINT_BROWSER_SOURCE}
      ${X_ARTICLE_IMAGE_FINGERPRINT_MATCH_BROWSER_SOURCE}
      ${X_ARTICLE_PUBLICATION_CANDIDATES_BROWSER_SOURCE}
      const guard = ${JSON.stringify(guard)};
      const visible = (element) => {
        if (!element || element.closest('[role="dialog"][aria-modal="true"]')) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const unique = (values) => Array.from(new Set(values));
      if (window.location.href !== guard.url) return false;

      const titles = unique(${JSON.stringify(I18N_SELECTORS.titleInput)}
        .flatMap((selector) => Array.from(document.querySelectorAll(selector))))
        .filter(visible);
      const bodies = Array.from(document.querySelectorAll(
        '.DraftEditor-editorContainer [data-contents="true"]'
      )).filter(visible);
      if (titles.length !== 1 || bodies.length !== 1) return false;
      const title = titles[0];
      const body = bodies[0];
      let root = title.closest('main, [role="main"], form');
      if (!root || !root.contains(body)) {
        root = title.parentElement;
        while (root && !root.contains(body)) root = root.parentElement;
      }
      if (!root) return false;

      const allBlocks = Array.from(body.querySelectorAll('[data-block="true"]'))
        .filter((block) => !block.parentElement?.closest('[data-block="true"]'));
      if (
        allBlocks.length === 0
        || allBlocks.some((block) => block.getAttribute('data-editor') !== guard.editorId)
      ) return false;

      const actualSequence = [];
      const accountedImages = new Set();
      const observedMedia = [];
      const mediaBlockIds = new Set();
      for (const block of allBlocks) {
        const images = Array.from(block.querySelectorAll('img')).filter(visible);
        const text = block.innerText || block.textContent || '';
        if (images.length > 0) {
          if (images.length !== 1 || text.replace(/\\s+/g, ' ').trim()) return false;
          const offsetKey = block.getAttribute('data-offset-key')
            || block.querySelector('[data-offset-key]')?.getAttribute('data-offset-key') || '';
          const keyMatch = offsetKey.match(/^(.+)-\\d+-\\d+$/);
          const blockId = keyMatch?.[1] || '';
          if (!blockId || mediaBlockIds.has(blockId)) return false;
          mediaBlockIds.add(blockId);
          const image = images[0];
          const source = image.currentSrc || image.src || '';
          if (!source) return false;
          const fingerprint = await xArticleImageFingerprint(image);
          accountedImages.add(image);
          observedMedia.push({ block, image, source });
          actualSequence.push({ kind: 'media', blockId, fingerprint });
        } else if (text.replace(/\\s+/g, ' ').trim()) {
          actualSequence.push({ kind: 'text', text });
        }
      }
      const bodyImages = Array.from(body.querySelectorAll('img')).filter(visible);
      if (
        bodyImages.length !== accountedImages.size
        || bodyImages.some((image) => !accountedImages.has(image))
      ) return false;

      if (actualSequence.length !== guard.bodySequence.length) return false;
      for (let index = 0; index < actualSequence.length; index++) {
        const actual = actualSequence[index];
        const expected = guard.bodySequence[index];
        if (!expected || actual.kind !== expected.kind) return false;
        if (actual.kind === 'text') {
          if (actual.text !== expected.text) return false;
        } else if (
          actual.blockId !== expected.blockId
          || !xArticleImageFingerprintsMatch(expected.fingerprint, actual.fingerprint)
        ) return false;
      }

      const coverImages = Array.from(root.querySelectorAll(
        '[data-testid*="cover" i] img, [data-testid*="headerMedia" i] img'
      )).filter(visible);
      if (coverImages.length !== guard.coverMedia.length) return false;
      const observedCovers = [];
      for (let index = 0; index < coverImages.length; index++) {
        const image = coverImages[index];
        const source = image.currentSrc || image.src || '';
        if (!source) return false;
        const fingerprint = await xArticleImageFingerprint(image);
        if (!xArticleImageFingerprintsMatch(guard.coverMedia[index].fingerprint, fingerprint)) {
          return false;
        }
        observedCovers.push({ image, source });
      }

      const currentTitle = title.value || title.innerText || title.textContent || '';
      const currentBody = body.innerText || body.textContent || '';
      if (
        window.location.href !== guard.url
        || currentTitle !== guard.title
        || currentBody !== guard.body
        || observedMedia.some(({ block, image, source }) => (
          !image.isConnected || !block.contains(image)
          || (image.currentSrc || image.src || '') !== source
        ))
        || observedCovers.some(({ image, source }) => (
          !image.isConnected || (image.currentSrc || image.src || '') !== source
        ))
      ) return false;

      const finalBlocks = Array.from(body.querySelectorAll('[data-block="true"]'))
        .filter((block) => !block.parentElement?.closest('[data-block="true"]'));
      const finalBodyImages = Array.from(body.querySelectorAll('img')).filter(visible);
      const finalCoverImages = Array.from(root.querySelectorAll(
        '[data-testid*="cover" i] img, [data-testid*="headerMedia" i] img'
      )).filter(visible);
      if (
        finalBlocks.length !== allBlocks.length
        || finalBlocks.some((block, index) => (
          block !== allBlocks[index] || block.getAttribute('data-editor') !== guard.editorId
        ))
        || finalBodyImages.length !== observedMedia.length
        || finalBodyImages.some((image, index) => image !== observedMedia[index].image)
        || finalCoverImages.length !== observedCovers.length
        || finalCoverImages.some((image, index) => image !== observedCovers[index].image)
      ) return false;

      const buttons = unique(${JSON.stringify(I18N_SELECTORS.publishButton)}
        .flatMap((selector) => Array.from(root.querySelectorAll(selector))))
        .filter((button) => visible(button) && !button.disabled
          && button.getAttribute('aria-disabled') !== 'true');
      if (buttons.length !== 1) return false;
      const baselineCandidates = xArticlePublicationCandidates();
      buttons[0].click();
      return { clicked: true, baselineCandidates };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  }, { sessionId, timeoutMs: 60_000 });
  return result.result.value;
}

async function readLocalXArticleImageFingerprint(
  cdp: Pick<CdpConnection, 'send'>,
  sessionId: string,
  imagePath: string,
): Promise<XArticleImageFingerprint> {
  const extension = path.extname(imagePath).toLowerCase();
  const mimeType = extension === '.png' ? 'image/png'
    : extension === '.webp' ? 'image/webp' : 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${fs.readFileSync(imagePath).toString('base64')}`;
  const result = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
    expression: `(async () => {
      ${X_ARTICLE_IMAGE_FINGERPRINT_BROWSER_SOURCE}
      const image = new Image();
      image.src = ${JSON.stringify(dataUrl)};
      try {
        await image.decode();
        return JSON.stringify({ fingerprint: await xArticleImageFingerprint(image) });
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : 'The reviewed image could not be fingerprinted.',
        });
      }
    })()`,
    awaitPromise: true,
    returnByValue: true,
  }, { sessionId, timeoutMs: 60_000 });
  const parsed = JSON.parse(result.result.value) as {
    error?: string;
    fingerprint?: XArticleImageFingerprint;
  };
  if (!parsed.fingerprint) {
    throw new Error(parsed.error ?? 'The reviewed X Article image fingerprint is unavailable.');
  }
  return parsed.fingerprint;
}

export async function setXArticleCoverFileExactly({
  cdp,
  sessionId,
  filePath,
}: {
  cdp: CdpConnection;
  sessionId: string;
  filePath: string;
}): Promise<void> {
  const markerKey = `__baoyuXArticleCoverInput_${randomUUID().replace(/-/g, '')}`;
  let chooserTimer: ReturnType<typeof setTimeout> | undefined;
  let stopListening: () => void = () => undefined;
  try {
    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true }, { sessionId });
    const chooser = new Promise<{ backendNodeId: number; mode: string }>((resolve, reject) => {
      chooserTimer = setTimeout(
        () => reject(new Error('The scoped X Article cover file chooser did not open.')),
        15_000,
      );
      stopListening = cdp.on('Page.fileChooserOpened', (params, metadata) => {
        if (metadata.sessionId !== sessionId) return;
        const event = params as { backendNodeId?: unknown; mode?: unknown };
        if (event.mode !== 'selectSingle' || !Number.isInteger(event.backendNodeId)) {
          reject(new Error('The X Article cover file chooser was not a single-file image input.'));
          return;
        }
        resolve({ backendNodeId: event.backendNodeId as number, mode: event.mode });
      });
    });

    const clicked = await cdp.send<{ result: { value: boolean } }>('Runtime.evaluate', {
      expression: `(() => {
        const visible = (element) => {
          if (!element || element.closest('[role="dialog"][aria-modal="true"]')) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0
            && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const titles = Array.from(new Set(${JSON.stringify(I18N_SELECTORS.titleInput)}
          .flatMap((selector) => Array.from(document.querySelectorAll(selector))))).filter(visible);
        const bodies = Array.from(document.querySelectorAll(
          '.DraftEditor-editorContainer [data-contents="true"]'
        )).filter(visible);
        if (titles.length !== 1 || bodies.length !== 1) return false;
        let root = titles[0].closest('main, [role="main"], form');
        if (!root || !root.contains(bodies[0])) {
          root = titles[0].parentElement;
          while (root && !root.contains(bodies[0])) root = root.parentElement;
        }
        if (!root) return false;
        const buttons = Array.from(new Set(${JSON.stringify(I18N_SELECTORS.addPhotosButton)}
          .flatMap((selector) => Array.from(root.querySelectorAll(selector))))).filter(visible);
        if (buttons.length !== 1) return false;
        const markerKey = ${JSON.stringify(markerKey)};
        const state = { input: null, cleanup: null };
        const captureActivatedFileInput = (event) => {
          const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
          const input = path.find((candidate) => (
            candidate instanceof HTMLInputElement && candidate.type === 'file'
          ));
          if (!input) return;
          state.input = input;
          document.removeEventListener('click', captureActivatedFileInput, true);
        };
        state.cleanup = () => document.removeEventListener('click', captureActivatedFileInput, true);
        window[markerKey] = state;
        document.addEventListener('click', captureActivatedFileInput, true);
        try {
          buttons[0].click();
          return true;
        } catch (error) {
          state.cleanup();
          delete window[markerKey];
          throw error;
        }
      })()`,
      returnByValue: true,
    }, { sessionId });
    if (!clicked.result.value) {
      throw new Error('The X Article cover upload control was missing or ambiguous.');
    }
    const opened = await chooser;
    const described = await cdp.send<{
      node: { backendNodeId?: number; nodeName?: string; attributes?: string[] };
    }>('DOM.describeNode', {
      backendNodeId: opened.backendNodeId,
    }, { sessionId });
    const attributes = new Map<string, string>();
    const rawAttributes = described.node.attributes ?? [];
    for (let index = 0; index < rawAttributes.length; index += 2) {
      attributes.set(rawAttributes[index]!.toLowerCase(), rawAttributes[index + 1] ?? '');
    }
    if (
      described.node.backendNodeId !== opened.backendNodeId
      || described.node.nodeName?.toUpperCase() !== 'INPUT'
      || attributes.get('type')?.toLowerCase() !== 'file'
      || !attributes.get('accept')?.split(',').some((value) => /^\s*image\//i.test(value))
    ) {
      throw new Error('The X Article cover chooser did not resolve to a single image file input.');
    }
    const resolved = await cdp.send<{ object: { objectId?: string } }>('DOM.resolveNode', {
      backendNodeId: opened.backendNodeId,
    }, { sessionId });
    if (!resolved.object.objectId) {
      throw new Error('The scoped X Article cover file input could not be resolved.');
    }
    const belongsToScopedControl = await cdp.send<{ result: { value: boolean } }>(
      'Runtime.callFunctionOn',
      {
        objectId: resolved.object.objectId,
        functionDeclaration: `function(markerKey) {
          const state = window[markerKey];
          return Boolean(
            state && state.input === this
            && this instanceof HTMLInputElement
            && this.type === 'file'
            && this.accept.split(',').some((value) => /^\\s*image\\//i.test(value))
          );
        }`,
        arguments: [{ value: markerKey }],
        returnByValue: true,
      },
      { sessionId },
    );
    if (!belongsToScopedControl.result.value) {
      throw new Error('The X Article cover chooser was not opened by the scoped cover input.');
    }
    await cdp.send('DOM.setFileInputFiles', {
      backendNodeId: opened.backendNodeId,
      files: [filePath],
    }, { sessionId });
  } finally {
    if (chooserTimer) clearTimeout(chooserTimer);
    stopListening();
    try {
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const markerKey = ${JSON.stringify(markerKey)};
          const state = window[markerKey];
          try { state?.cleanup?.(); } finally { delete window[markerKey]; }
        })()`,
        returnByValue: true,
      }, { sessionId }).catch(() => undefined);
    } finally {
      await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false }, { sessionId })
        .catch(() => undefined);
    }
  }
}

export function findSingleAddedXArticleMediaSource(
  before: readonly string[],
  after: readonly string[],
): string {
  if (after.length !== before.length + 1) {
    throw new Error('X Article media insertion did not add exactly one image.');
  }
  const remaining = new Map<string, number>();
  for (const source of before) remaining.set(source, (remaining.get(source) ?? 0) + 1);
  const added: string[] = [];
  for (const source of after) {
    const count = remaining.get(source) ?? 0;
    if (count > 0) remaining.set(source, count - 1);
    else added.push(source);
  }
  if (added.length !== 1 || [...remaining.values()].some((count) => count !== 0)) {
    throw new Error('X Article media insertion did not add exactly one stable image source.');
  }
  return added[0]!;
}

function xArticleReviewedAssetId(imagePath: string, occurrence: number): string {
  const digest = createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex');
  return `sha256:${digest}:occurrence:${occurrence}`;
}

function buildReviewedXArticleBodySequence(
  reviewedBodyWithPlaceholders: string,
  images: readonly { placeholder: string; assetId: string }[],
): ReviewedXArticleBodyToken[] {
  const positions = images.map((image) => {
    const position = reviewedBodyWithPlaceholders.indexOf(image.placeholder);
    if (
      position < 0
      || reviewedBodyWithPlaceholders.indexOf(image.placeholder, position + image.placeholder.length) >= 0
    ) {
      throw new Error(`The reviewed X Article image placeholder is missing or duplicated: ${image.placeholder}.`);
    }
    return { ...image, position };
  }).sort((left, right) => left.position - right.position);

  const sequence: ReviewedXArticleBodyToken[] = [];
  let cursor = 0;
  for (const image of positions) {
    if (image.position < cursor) {
      throw new Error('The reviewed X Article image placeholders overlap.');
    }
    const text = reviewedBodyWithPlaceholders.slice(cursor, image.position);
    if (normalizeArticleBodyText(text)) sequence.push({ kind: 'text', text });
    sequence.push({ kind: 'media', assetId: image.assetId });
    cursor = image.position + image.placeholder.length;
  }
  const trailingText = reviewedBodyWithPlaceholders.slice(cursor);
  if (normalizeArticleBodyText(trailingText)) sequence.push({ kind: 'text', text: trailingText });
  return sequence;
}

function findSingleAddedXArticleMediaBlock(
  before: readonly RenderedXArticleBodyToken[],
  after: readonly RenderedXArticleBodyToken[],
): Extract<RenderedXArticleBodyToken, { kind: 'media' }> {
  const beforeIds = new Set(before.filter((token) => token.kind === 'media').map((token) => token.blockId));
  const afterMedia = after.filter(
    (token): token is Extract<RenderedXArticleBodyToken, { kind: 'media' }> => token.kind === 'media',
  );
  const added = afterMedia.filter((token) => !beforeIds.has(token.blockId));
  if (
    added.length !== 1
    || afterMedia.length !== beforeIds.size + 1
    || [...beforeIds].some((blockId) => !afterMedia.some((token) => token.blockId === blockId))
  ) {
    throw new Error('X Article media insertion did not add exactly one stable editor media block.');
  }
  return added[0]!;
}

export interface XArticleCompositionReport {
  titleMatches: boolean;
  bodyMatches: boolean;
  expectedImages: number;
  actualImages: number;
  expectedMediaSources: readonly string[];
  actualMediaSources: readonly string[];
  remainingPlaceholders: string[];
  coverRequested: boolean;
  initialCoverSources: readonly string[];
  actualCoverSources: readonly string[];
}

export function assertXArticleCompositionReady(report: XArticleCompositionReport): void {
  const failures: string[] = [];
  if (!report.titleMatches) failures.push('title does not match the reviewed draft');
  if (!report.bodyMatches) failures.push('body does not match the reviewed draft');
  if (report.actualImages !== report.expectedImages) {
    failures.push(`image count ${report.actualImages}/${report.expectedImages}`);
  }
  if (
    report.expectedMediaSources.length !== report.expectedImages
    || report.actualMediaSources.length !== report.actualImages
    || report.actualMediaSources.length !== report.expectedMediaSources.length
    || report.actualMediaSources.some((source, index) => source !== report.expectedMediaSources[index])
  ) {
    failures.push('body media order or insertion provenance does not match the reviewed draft');
  }
  if (report.remainingPlaceholders.length > 0) {
    failures.push(`remaining placeholders: ${report.remainingPlaceholders.join(', ')}`);
  }
  const coverSources = report.actualCoverSources;
  if (report.coverRequested) {
    if (
      coverSources.length !== 1
      || report.initialCoverSources.includes(coverSources[0] ?? '')
    ) {
      failures.push('cover does not contain one newly applied visible editor-header source');
    }
  } else if (coverSources.length !== 0) {
    failures.push('cover is present even though the reviewed draft is coverless');
  }
  if (failures.length > 0) {
    throw new Error(`X Article composition failed: ${failures.join('; ')}.`);
  }
}

export interface XArticleCompositionContext {
  cdp: CdpConnection;
  sessionId: string;
  targetId: string;
  ownsBrowser: boolean;
  ownsTarget: boolean;
  releaseOwnedBrowser?: () => void | Promise<void>;
  title: string;
  body: string;
  expectedBody: string;
  imageCount: number;
  coverPresent: boolean;
  reviewedBodySequence: ReviewedXArticleBodyToken[];
  mediaBindings: XArticleMediaAssetBinding[];
  coverFingerprint?: XArticleImageFingerprint;
}

export type XArticleBrowserResource = {
  cdp: Pick<CdpConnection, 'send' | 'close'>;
  targetId?: string;
  ownsBrowser: boolean;
  ownsTarget: boolean;
  releaseOwnedBrowser?: () => void | Promise<void>;
};

export async function acquireXArticleCdp<T>(
  acquire: () => Promise<T>,
  releaseOwnedChrome?: () => void | Promise<void>,
): Promise<T> {
  try {
    return await acquire();
  } catch (error) {
    try {
      await releaseOwnedChrome?.();
    } catch {
      // Preserve the acquisition failure; cleanup is best effort.
    }
    throw error;
  }
}

function chromeHasExited(chrome: ReturnType<typeof spawn>): boolean {
  return chrome.exitCode !== null || chrome.signalCode !== null;
}

async function terminateOwnedXChrome(chrome: ReturnType<typeof spawn>): Promise<void> {
  if (chromeHasExited(chrome)) return;
  try {
    chrome.kill('SIGTERM');
  } catch {
    return;
  }
  if (chromeHasExited(chrome)) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      chrome.off('exit', finish);
      resolve();
    };
    const timer = setTimeout(finish, 2_000);
    chrome.once('exit', finish);
  });
  if (!chromeHasExited(chrome)) {
    try {
      chrome.kill('SIGKILL');
    } catch {
      // The exact owned process may have exited between the state check and kill.
    }
  }
}

const releasedBrowserConnections = new WeakSet<object>();

export async function releaseXArticleBrowserResource(
  resource: XArticleBrowserResource,
): Promise<void> {
  const connection = resource.cdp as object;
  if (releasedBrowserConnections.has(connection)) return;
  releasedBrowserConnections.add(connection);
  try {
    if (resource.ownsBrowser) {
      try {
        await resource.cdp.send('Browser.close', {}, { timeoutMs: 5_000 });
      } catch {
        await resource.releaseOwnedBrowser?.();
      }
    } else if (resource.ownsTarget && resource.targetId) {
      await resource.cdp.send('Target.closeTarget', { targetId: resource.targetId });
    }
  } catch {
    // The operator may already have closed the owned browser or target.
  } finally {
    resource.cdp.close();
  }
}

export async function openManagedXArticlePage(
  resource: XArticleBrowserResource,
): Promise<{ targetId: string; sessionId: string }> {
  try {
    let targetId: string | undefined;
    if (resource.ownsBrowser) {
      const targets = await resource.cdp.send<{
        targetInfos: Array<{ targetId: string; url: string; type: string }>;
      }>('Target.getTargets', {});
      targetId = targets.targetInfos.find((target) => (
        target.type === 'page' && target.url.startsWith(X_ARTICLES_URL)
      ))?.targetId;
    }

    if (!targetId) {
      const created = await resource.cdp.send<{ targetId: string }>('Target.createTarget', {
        url: X_ARTICLES_URL,
      });
      targetId = created.targetId;
    }
    if (!targetId) throw new Error('Target.createTarget did not return an X Article target ID.');

    resource.targetId = targetId;
    resource.ownsTarget = true;

    const attached = await resource.cdp.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    await resource.cdp.send('Target.activateTarget', { targetId });
    await resource.cdp.send('Page.enable', {}, { sessionId: attached.sessionId });
    await resource.cdp.send('Runtime.enable', {}, { sessionId: attached.sessionId });
    await resource.cdp.send('DOM.enable', {}, { sessionId: attached.sessionId });
    return { targetId, sessionId: attached.sessionId };
  } catch (error) {
    await releaseXArticleBrowserResource(resource);
    throw error;
  }
}

export interface ArticleOptions {
  markdownPath: string;
  coverImage?: string;
  title?: string;
  submit?: boolean;
  profileDir?: string;
  chromePath?: string;
  inferCoverFromFirstImage?: boolean;
  onComposed?: (context: XArticleCompositionContext) => void | Promise<void>;
}

async function findExistingDebugPort(profileDir: string): Promise<number | null> {
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  if (!fs.existsSync(portFile)) return null;

  try {
    const content = fs.readFileSync(portFile, 'utf-8').trim();
    if (!content) return null;
    const [portLine] = content.split(/\r?\n/);
    const port = Number(portLine);
    if (!Number.isFinite(port) || port <= 0) return null;

    // Verify the port is actually active.
    await waitForChromeDebugPort(port, 1500, { includeLastError: true });
    return port;
  } catch {
    return null;
  }
}

export async function publishArticle(options: ArticleOptions): Promise<void> {
  assertXArticlePublishMode(options);
  const { markdownPath, submit = false, profileDir = getDefaultProfileDir() } = options;

  console.log('[x-article] Parsing markdown...');
  const parsed = await parseMarkdown(markdownPath, {
    title: options.title,
    coverImage: options.coverImage,
    inferCoverFromFirstImage: options.inferCoverFromFirstImage,
  });

  console.log(`[x-article] Title: ${parsed.title}`);
  console.log(`[x-article] Cover: ${parsed.coverImage ?? 'none'}`);
  console.log(`[x-article] Content images: ${parsed.contentImages.length}`);

  // Save HTML to temp file
  const htmlPath = path.join(os.tmpdir(), 'x-article-content.html');
  await writeFile(htmlPath, parsed.html, 'utf-8');
  console.log(`[x-article] HTML saved to: ${htmlPath}`);

  const chromePath = options.chromePath ?? findChromeExecutable(CHROME_CANDIDATES_BASIC);
  if (!chromePath) throw new Error('Chrome not found');

  await mkdir(profileDir, { recursive: true });
  const existingPort = await findExistingDebugPort(profileDir);
  const port = existingPort ?? await getFreePort();

  let ownedChrome: ReturnType<typeof spawn> | null = null;
  let ownedChromeLaunchError: Promise<never> | null = null;
  if (existingPort) {
    console.log(`[x-article] Reusing existing Chrome instance on port ${port}`);
  } else {
    console.log(`[x-article] Launching Chrome...`);
    const chromeArgs = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--start-maximized',
      X_ARTICLES_URL,
    ];
    ownedChrome = spawn(chromePath, chromeArgs, { stdio: 'ignore' });
    ownedChromeLaunchError = new Promise<never>((_resolve, reject) => {
      ownedChrome!.once('error', reject);
    });
    ownedChrome.unref();
  }

  let cdp: CdpConnection | null = null;
  let handedOff = false;
  let browserResource: XArticleBrowserResource | null = null;

  try {
    cdp = await acquireXArticleCdp(async () => {
      const ready = waitForChromeDebugPort(port, 30_000, { includeLastError: true });
      const wsUrl = ownedChromeLaunchError
        ? await Promise.race([ready, ownedChromeLaunchError])
        : await ready;
      return CdpConnection.connect(wsUrl, 30_000, { defaultTimeoutMs: 60_000 });
    }, ownedChrome ? () => terminateOwnedXChrome(ownedChrome) : undefined);
    browserResource = {
      cdp,
      ownsBrowser: !existingPort,
      ownsTarget: false,
      ...(ownedChrome ? {
        releaseOwnedBrowser: () => terminateOwnedXChrome(ownedChrome!),
      } : {}),
    };
    const page = await openManagedXArticlePage(browserResource);
    const { sessionId } = page;

    console.log('[x-article] Waiting for articles page...');
    await sleep(1000);

    // Wait for and click "create" button
    const waitForElement = async (selector: string, timeoutMs = 60_000): Promise<boolean> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const result = await cdp!.send<{ result: { value: boolean } }>('Runtime.evaluate', {
          expression: `!!document.querySelector('${selector}')`,
          returnByValue: true,
        }, { sessionId });
        if (result.result.value) return true;
        await sleep(500);
      }
      return false;
    };

    const clickElement = async (selector: string): Promise<boolean> => {
      const result = await cdp!.send<{ result: { value: boolean } }>('Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector('${selector}'); if (el) { el.click(); return true; } return false; })()`,
        returnByValue: true,
      }, { sessionId });
      return result.result.value;
    };

    const typeText = async (selector: string, text: string): Promise<void> => {
      await cdp!.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelector('${selector}');
          if (el) {
            el.focus();
            document.execCommand('insertText', false, ${JSON.stringify(text)});
          }
        })()`,
      }, { sessionId });
    };

    const pressKey = async (key: string, modifiers = 0): Promise<void> => {
      await cdp!.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        code: `Key${key.toUpperCase()}`,
        modifiers,
        windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
      }, { sessionId });
      await cdp!.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code: `Key${key.toUpperCase()}`,
        modifiers,
        windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
      }, { sessionId });
    };

    // Check if we're on the articles list page (has Write button)
    console.log('[x-article] Looking for Write button...');
    const writeButtonFound = await waitForElement('[data-testid="empty_state_button_text"]', 10_000);

    if (writeButtonFound) {
      console.log('[x-article] Clicking Write button...');
      await cdp.send('Runtime.evaluate', {
        expression: `document.querySelector('[data-testid="empty_state_button_text"]')?.click()`,
      }, { sessionId });
      await sleep(2000);
    }

    // Wait for editor (title textarea)
    const titleSelectors = I18N_SELECTORS.titleInput.join(', ');
    console.log('[x-article] Waiting for editor...');
    const editorFound = await waitForElement(titleSelectors, 30_000);
    if (!editorFound) {
      const state = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
        expression: `JSON.stringify({ url: window.location.href, text: document.body?.innerText || '' })`,
        returnByValue: true,
      }, { sessionId });
      const page = JSON.parse(state.result.value) as { url: string; text: string };
      const loginRequired = /\/i\/flow\/login(?:[/?#]|$)/.test(new URL(page.url).pathname)
        || /\b(log in|sign in)\b/i.test(page.text);
      throw Object.assign(
        new Error(loginRequired
          ? 'Log in to X before preparing an Article.'
          : 'X Articles are unavailable for this account.'),
        { code: loginRequired ? 'X_LOGIN_REQUIRED' : 'X_ARTICLES_UNAVAILABLE' },
      );
    }

    const readEditorSnapshot = (): Promise<XArticleEditorSnapshot> => (
      readXArticleEditorSnapshot(cdp!, sessionId)
    );
    const initialCoverSources = (await readEditorSnapshot()).coverSources;
    const reviewedCoverFingerprint = parsed.coverImage
      ? await readLocalXArticleImageFingerprint(cdp, sessionId, parsed.coverImage)
      : undefined;

    // Upload cover image
    if (parsed.coverImage) {
      console.log('[x-article] Uploading cover image...');
      await setXArticleCoverFileExactly({ cdp, sessionId, filePath: parsed.coverImage });
      console.log('[x-article] Cover image file set');

      console.log('[x-article] Waiting for the cover crop Apply button...');
      const applyFound = await waitForElement(
        '[role="dialog"][aria-modal="true"] [data-testid="applyButton"]',
        15_000,
      );
      if (!applyFound) throw new Error('The X Article cover crop Apply button was not found.');

      const isModalOpen = async (): Promise<boolean> => {
        const result = await cdp!.send<{ result: { value: boolean } }>('Runtime.evaluate', {
          expression: `(() => {
            const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
            if (!dialog) return false;
            const rect = dialog.getBoundingClientRect();
            const style = getComputedStyle(dialog);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          })()`,
          returnByValue: true,
        }, { sessionId });
        return result.result.value;
      };

      let modalClosed = false;
      for (let attempt = 1; attempt <= 3 && !modalClosed; attempt++) {
        console.log(`[x-article] Clicking cover Apply (attempt ${attempt}/3)...`);
        const applyClicked = await cdp.send<{ result: { value: boolean } }>('Runtime.evaluate', {
          expression: `(() => {
            const buttons = Array.from(document.querySelectorAll(
              '[role="dialog"][aria-modal="true"] [data-testid="applyButton"]'
            ));
            const button = buttons.find((element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
            });
            if (!button) return false;
            button.click();
            return true;
          })()`,
          returnByValue: true,
        }, { sessionId });
        if (!applyClicked.result.value) continue;
        const started = Date.now();
        while (Date.now() - started < 5_000) {
          await sleep(300);
          if (!await isModalOpen()) {
            modalClosed = true;
            break;
          }
        }
      }
      if (!modalClosed) throw new Error('The X Article cover crop dialog did not close after Apply.');

      let coverApplied = false;
      const coverStarted = Date.now();
      while (Date.now() - coverStarted < 15_000) {
        const snapshot = await readEditorSnapshot();
        if (
          snapshot.coverMedia.length === 1
          && !initialCoverSources.includes(snapshot.coverMedia[0]!.source)
          && reviewedCoverFingerprint
          && xArticleImageFingerprintsMatch(
            reviewedCoverFingerprint,
            snapshot.coverMedia[0]!.fingerprint,
          )
        ) {
          coverApplied = true;
          break;
        }
        await sleep(300);
      }
      if (!coverApplied) throw new Error('The X Article editor did not show the newly applied cover.');
    }

    // Fill title using keyboard input
    if (parsed.title) {
      console.log('[x-article] Filling title...');

      // Focus title input
      const titleInputSelectors = JSON.stringify(I18N_SELECTORS.titleInput);
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const selectors = ${titleInputSelectors};
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) { el.focus(); return true; }
          }
          return false;
        })()`,
      }, { sessionId });
      await sleep(200);

      // Type title character by character using insertText
      await cdp.send('Input.insertText', { text: parsed.title }, { sessionId });
      await sleep(300);

      // Tab out to trigger save
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, { sessionId });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, { sessionId });
      await sleep(500);
    }

    // Insert HTML content
    console.log('[x-article] Inserting content...');

    // Read HTML content
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const expectedBodyText = xArticleHtmlToText(htmlContent);

    const readArticleBody = async (): Promise<string> => {
      const result = await cdp!.send<{ result: { value: string } }>('Runtime.evaluate', {
        expression: `document.querySelector('.DraftEditor-editorContainer [data-contents="true"]')?.innerText || ''`,
        returnByValue: true,
      }, { sessionId });
      return result.result.value;
    };
    const clearArticleBody = async (): Promise<void> => {
      const focused = await cdp!.send<{ result: { value: boolean } }>('Runtime.evaluate', {
        expression: `(() => {
          const editor = document.querySelector('.DraftEditor-editorContainer [contenteditable="true"]');
          if (!editor) return false;
          editor.focus();
          return true;
        })()`,
        returnByValue: true,
      }, { sessionId });
      if (!focused.result.value) throw new Error('The X Article body editor could not be focused for clearing.');
      const selectionModifier = process.platform === 'darwin' ? 4 : 2;
      await cdp!.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown', key: 'a', code: 'KeyA', modifiers: selectionModifier,
        windowsVirtualKeyCode: 65,
      }, { sessionId });
      await cdp!.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'a', code: 'KeyA', modifiers: selectionModifier,
        windowsVirtualKeyCode: 65,
      }, { sessionId });
      await cdp!.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8,
      }, { sessionId });
      await cdp!.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8,
      }, { sessionId });
      await waitForXArticleBodyCleared({
        read: readArticleBody,
        readMediaCount: async () => (await readEditorSnapshot()).mediaSources.length,
        wait: () => sleep(150),
        maxChecks: 20,
      });
    };

    await insertXArticleBodyExactly({
      expectedText: expectedBodyText,
      clear: clearArticleBody,
      attempts: [
        async () => {
          console.log('[x-article] Attempting to insert HTML via paste event...');
          await cdp!.send('Runtime.evaluate', {
            expression: `(() => {
              const editor = document.querySelector('.DraftEditor-editorContainer [contenteditable="true"]');
              if (!editor) return false;
              const dt = new DataTransfer();
              dt.setData('text/html', ${JSON.stringify(htmlContent)});
              dt.setData('text/plain', ${JSON.stringify(expectedBodyText)});
              editor.dispatchEvent(new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dt,
              }));
              return true;
            })()`,
          }, { sessionId });
          await sleep(1000);
        },
        async () => {
          console.log('[x-article] Paste event did not produce exact content; trying insertHTML...');
          await cdp!.send('Runtime.evaluate', {
            expression: `(() => {
              const editor = document.querySelector('.DraftEditor-editorContainer [contenteditable="true"]');
              if (!editor) return false;
              editor.focus();
              return document.execCommand('insertHTML', false, ${JSON.stringify(htmlContent)});
            })()`,
          }, { sessionId });
          await sleep(1000);
        },
        async () => {
          console.log('[x-article] Automatic insertion failed. Copying HTML for one isolated manual paste...');
          if (!copyHtmlToClipboard(htmlPath)) {
            throw new Error('The reviewed X Article HTML could not be copied to the clipboard.');
          }
          console.log('[x-article] Waiting 30s for manual paste (Cmd+V)...');
          await sleep(30_000);
        },
      ],
      read: readArticleBody,
    });
    console.log('[x-article] Exact reviewed body insertion verified.');

    const reviewedImages: Array<(typeof parsed.contentImages)[number] & {
      assetId: string;
      fingerprint: XArticleImageFingerprint;
    }> = [];
    for (const [index, image] of parsed.contentImages.entries()) {
      reviewedImages.push({
        ...image,
        assetId: xArticleReviewedAssetId(image.localPath, index + 1),
        fingerprint: await readLocalXArticleImageFingerprint(cdp, sessionId, image.localPath),
      });
    }
    const reviewedBodySequence = buildReviewedXArticleBodySequence(
      expectedBodyText,
      reviewedImages,
    );
    const mediaBindings: XArticleMediaAssetBinding[] = [];

    // Insert content images at their reviewed placeholders.
    if (parsed.contentImages.length > 0) {
      console.log('[x-article] Inserting content images...');

      // First, check what placeholders exist in the editor
      const editorContent = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
        expression: `document.querySelector('.DraftEditor-editorContainer [data-contents="true"]')?.innerText || ''`,
        returnByValue: true,
      }, { sessionId });

      console.log('[x-article] Checking for placeholders in content...');
      for (const img of reviewedImages) {
        // Use an exact suffix boundary so IMG_1 cannot match IMG_10.
        const regex = new RegExp(img.placeholder + '(?!\\d)');
        if (regex.test(editorContent.result.value)) {
          console.log(`[x-article] Found: ${img.placeholder}`);
        } else {
          console.log(`[x-article] NOT found: ${img.placeholder}`);
        }
      }

      // Process images in their namespaced IMG order regardless of blockIndex.
      const getPlaceholderIndex = (placeholder: string): number => {
        const match = placeholder.match(/IMG_(\d+)$/);
        return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
      };
      const sortedImages = [...reviewedImages].sort(
        (a, b) => getPlaceholderIndex(a.placeholder) - getPlaceholderIndex(b.placeholder),
      );

      for (let i = 0; i < sortedImages.length; i++) {
        const img = sortedImages[i]!;
        console.log(`[x-article] [${i + 1}/${sortedImages.length}] Inserting image at placeholder: ${img.placeholder}`);

        // Helper to select placeholder with retry
        const selectPlaceholder = async (maxRetries = 3): Promise<boolean> => {
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            // Find, scroll to, and select the placeholder text in DraftEditor
            await cdp!.send('Runtime.evaluate', {
              expression: `(() => {
                const editor = document.querySelector('.DraftEditor-editorContainer [data-contents="true"]');
                if (!editor) return false;

                const placeholder = ${JSON.stringify(img.placeholder)};

                // Search through all text nodes in the editor
                const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null, false);
                let node;

                while ((node = walker.nextNode())) {
                  const text = node.textContent || '';
                  let searchStart = 0;
                  let idx;
                  // Search for an exact match (IMG_1 must not match IMG_10).
                  while ((idx = text.indexOf(placeholder, searchStart)) !== -1) {
                    const afterIdx = idx + placeholder.length;
                    const charAfter = text[afterIdx];
                    // An exact placeholder cannot be followed by another index digit.
                    if (charAfter === undefined || !/\\d/.test(charAfter)) {
                      // Found exact placeholder - scroll to it first
                      const parentElement = node.parentElement;
                      if (parentElement) {
                        parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }

                      // Select it
                      const range = document.createRange();
                      range.setStart(node, idx);
                      range.setEnd(node, idx + placeholder.length);
                      const sel = window.getSelection();
                      sel.removeAllRanges();
                      sel.addRange(range);
                      return true;
                    }
                    searchStart = afterIdx;
                  }
                }
                return false;
              })()`,
            }, { sessionId });

            // Wait for scroll and selection to settle
            await sleep(800);

            // Verify selection matches the placeholder
            const selectionCheck = await cdp!.send<{ result: { value: string } }>('Runtime.evaluate', {
              expression: `window.getSelection()?.toString() || ''`,
              returnByValue: true,
            }, { sessionId });

            const selectedText = selectionCheck.result.value.trim();
            if (selectedText === img.placeholder) {
              console.log(`[x-article] Selection verified: "${selectedText}"`);
              return true;
            }

            if (attempt < maxRetries) {
              console.log(`[x-article] Selection attempt ${attempt} got "${selectedText}", retrying...`);
              await sleep(500);
            } else {
              console.warn(`[x-article] Selection failed after ${maxRetries} attempts, got: "${selectedText}"`);
            }
          }
          return false;
        };

        // Try to select the placeholder
        const selected = await selectPlaceholder(3);
        if (!selected) {
          throw new Error(`The X Article image placeholder could not be selected: ${img.placeholder}.`);
        }

        console.log(`[x-article] Copying image: ${path.basename(img.localPath)}`);

        // Copy image to clipboard
        if (!copyImageToClipboard(img.localPath)) {
          throw new Error(`The reviewed X Article image could not be copied: ${path.basename(img.localPath)}.`);
        }

        // Wait for clipboard to be fully ready
        await sleep(1000);

        // Delete placeholder using execCommand (more reliable than keyboard events for DraftJS)
        console.log(`[x-article] Deleting placeholder...`);
        const deleteResult = await cdp.send<{ result: { value: boolean } }>('Runtime.evaluate', {
          expression: `(() => {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed) return false;
            // Try execCommand delete first
            if (document.execCommand('delete', false)) return true;
            // Fallback: replace selection with empty using insertText
            document.execCommand('insertText', false, '');
            return true;
          })()`,
          returnByValue: true,
        }, { sessionId });

        await sleep(500);

        // Check that placeholder is no longer in editor (exact match, not substring)
        const afterDelete = await cdp.send<{ result: { value: boolean } }>('Runtime.evaluate', {
          expression: `(() => {
            const editor = document.querySelector('.DraftEditor-editorContainer [data-contents="true"]');
            if (!editor) return true;
            const text = editor.innerText;
            const placeholder = ${JSON.stringify(img.placeholder)};
            // Use regex to find exact match (not followed by digit)
            const regex = new RegExp(placeholder + '(?!\\\\d)');
            return !regex.test(text);
          })()`,
          returnByValue: true,
        }, { sessionId });

        if (!afterDelete.result.value) {
          console.warn(`[x-article] Placeholder may not have been deleted, trying dispatchEvent...`);
          // Try selecting and deleting with InputEvent
          await selectPlaceholder(1);
          await sleep(300);
          await cdp.send('Runtime.evaluate', {
            expression: `(() => {
              const editor = document.querySelector('.DraftEditor-editorContainer [contenteditable="true"]');
              if (!editor) return;
              editor.focus();
              // Dispatch beforeinput and input events for deletion
              const beforeEvent = new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true });
              editor.dispatchEvent(beforeEvent);
              const inputEvent = new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true });
              editor.dispatchEvent(inputEvent);
            })()`,
          }, { sessionId });
          await sleep(500);
        }

        const mediaSnapshotBefore = await readEditorSnapshot();

        // Focus editor to ensure cursor is in position
        await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const editor = document.querySelector('.DraftEditor-editorContainer [contenteditable="true"]');
            if (editor) editor.focus();
          })()`,
        }, { sessionId });
        await sleep(300);

        // Paste image using paste script (activates Chrome, sends real keystroke)
        console.log(`[x-article] Pasting image...`);
        if (pasteFromClipboard('Google Chrome', 5, 1000)) {
          console.log(`[x-article] Image pasted: ${path.basename(img.localPath)}`);
        } else {
          throw new Error(`The reviewed X Article image could not be pasted: ${path.basename(img.localPath)}.`);
        }

        // Verify image appeared in editor
        console.log(`[x-article] Verifying image upload...`);
        const expectedImgCount = mediaSnapshotBefore.mediaSources.length + 1;
        let insertedMedia: Extract<RenderedXArticleBodyToken, { kind: 'media' }> | null = null;
        const imgWaitStart = Date.now();
        while (Date.now() - imgWaitStart < 15_000) {
          const mediaSnapshotAfter = await readEditorSnapshot();
          try {
            insertedMedia = findSingleAddedXArticleMediaBlock(
              mediaSnapshotBefore.bodySequence,
              mediaSnapshotAfter.bodySequence,
            );
            break;
          } catch {}
          await sleep(1000);
        }

        if (insertedMedia) {
          mediaBindings.push(bindXArticleMediaAsset({
            blockId: insertedMedia.blockId,
            assetId: img.assetId,
            reviewedFingerprint: img.fingerprint,
            renderedFingerprint: insertedMedia.fingerprint,
          }));
          console.log(`[x-article] Image upload verified (${expectedImgCount} image block(s))`);
          // Wait for DraftEditor DOM to stabilize after image insertion
          await sleep(3000);
        } else {
          throw new Error(`The reviewed X Article image did not produce one new stable media block: ${path.basename(img.localPath)}.`);
        }
      }

      console.log('[x-article] All images processed.');
    }

    const expectedFinalBodyText = deriveXArticleFinalBodyText(
      htmlContent,
      parsed.contentImages.map((image) => image.placeholder),
    );

    const verifyCurrentComposition = async (): Promise<{
      snapshot: XArticleEditorSnapshot;
      title: string;
      body: string;
      imageCount: number;
      coverPresent: boolean;
    }> => {
      const snapshot = await readEditorSnapshot();
      const actualMediaBlockIds = snapshot.bodySequence
        .filter((token): token is Extract<RenderedXArticleBodyToken, { kind: 'media' }> => (
          token.kind === 'media'
        ))
        .map((token) => token.blockId);
      const remainingPlaceholders = parsed.contentImages
        .map((image) => image.placeholder)
        .filter((placeholder) => renderedPlaceholderPattern(placeholder).test(snapshot.body));
      assertXArticleBodyMediaEvidence({
        reviewedSequence: reviewedBodySequence,
        renderedSequence: snapshot.bodySequence,
        verifiedAssetBindings: mediaBindings,
      });
      if (
        reviewedCoverFingerprint
        && (
          snapshot.coverMedia.length !== 1
          || !xArticleImageFingerprintsMatch(
            reviewedCoverFingerprint,
            snapshot.coverMedia[0]!.fingerprint,
          )
        )
      ) {
        throw new Error('X Article composition failed: cover identity does not match the reviewed asset.');
      }
      assertXArticleCompositionReady({
        titleMatches: snapshot.title.trim() === parsed.title.trim(),
        bodyMatches: isXArticleBodyInserted(snapshot.body, expectedFinalBodyText),
        expectedImages: parsed.contentImages.length,
        actualImages: actualMediaBlockIds.length,
        expectedMediaSources: mediaBindings.map((binding) => binding.blockId),
        actualMediaSources: actualMediaBlockIds,
        remainingPlaceholders,
        coverRequested: Boolean(parsed.coverImage),
        initialCoverSources,
        actualCoverSources: snapshot.coverSources,
      });
      return {
        snapshot,
        title: snapshot.title,
        body: snapshot.body,
        imageCount: actualMediaBlockIds.length,
        coverPresent: snapshot.coverSources.length === 1,
      };
    };

    const waitForSettledComposition = async (): Promise<Awaited<ReturnType<typeof verifyCurrentComposition>>> => {
      let previousSignature = '';
      for (let check = 0; check < 12; check++) {
        const current = await verifyCurrentComposition();
        const signature = JSON.stringify({
          url: current.snapshot.url,
          editorId: current.snapshot.editorId,
          title: current.title,
          body: current.body,
          mediaBlockIds: current.snapshot.bodySequence
            .filter((token) => token.kind === 'media')
            .map((token) => token.blockId),
          coverSources: current.snapshot.coverSources,
        });
        if (signature === previousSignature) return current;
        previousSignature = signature;
        await sleep(300);
      }
      throw new Error('The X Article editor did not settle to two consecutive verified snapshots.');
    };

    // Blur and require a stable, exact client composition. This deliberately
    // does not claim a server save acknowledgement that X does not expose.
    console.log('[x-article] Settling the reviewed editor composition...');
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        // Blur editor to trigger any pending saves
        const editor = document.querySelector('.DraftEditor-editorContainer [contenteditable="true"]');
        if (editor) {
          editor.blur();
        }
        // Also click elsewhere to ensure focus is lost
        document.body.click();
      })()`,
    }, { sessionId });
    const verifiedComposition = await waitForSettledComposition();
    console.log(`[x-article] Verification passed: ${verifiedComposition.imageCount} identity-bound image(s), exact reviewed body, scoped cover evidence.`);

    // Click Preview button
    console.log('[x-article] Opening preview...');
    const previewSelectors = JSON.stringify(I18N_SELECTORS.previewButton);
    const previewClicked = await cdp.send<{ result: { value: boolean } }>('Runtime.evaluate', {
      expression: `(() => {
        const visible = (element) => {
          if (!element || element.closest('[role="dialog"][aria-modal="true"]')) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0
            && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const titles = Array.from(new Set(${JSON.stringify(I18N_SELECTORS.titleInput)}
          .flatMap((selector) => Array.from(document.querySelectorAll(selector))))).filter(visible);
        const bodies = Array.from(document.querySelectorAll(
          '.DraftEditor-editorContainer [data-contents="true"]'
        )).filter(visible);
        if (titles.length !== 1 || bodies.length !== 1) return false;
        let root = titles[0].closest('main, [role="main"], form');
        if (!root || !root.contains(bodies[0])) {
          root = titles[0].parentElement;
          while (root && !root.contains(bodies[0])) root = root.parentElement;
        }
        if (!root) return false;
        const buttons = Array.from(new Set(${previewSelectors}
          .flatMap((selector) => Array.from(root.querySelectorAll(selector))))).filter(visible);
        if (buttons.length !== 1) return false;
        buttons[0].click();
        return true;
      })()`,
      returnByValue: true,
    }, { sessionId });

    if (previewClicked.result.value) {
      console.log('[x-article] Preview opened');
      await sleep(3000);
    } else {
      console.log('[x-article] Preview button not found');
    }

    // Preview can rerender or replace the editor. Revalidate its exact state
    // before either handing ownership off or allowing standalone submission.
    const postPreviewComposition = await waitForSettledComposition();

    if (options.onComposed) {
      await options.onComposed({
        cdp,
        sessionId,
        targetId: page.targetId,
        ownsBrowser: !existingPort,
        ownsTarget: browserResource.ownsTarget,
        ...(browserResource.releaseOwnedBrowser ? {
          releaseOwnedBrowser: browserResource.releaseOwnedBrowser,
        } : {}),
        title: postPreviewComposition.title,
        body: postPreviewComposition.body,
        imageCount: postPreviewComposition.imageCount,
        coverPresent: postPreviewComposition.coverPresent,
        expectedBody: expectedFinalBodyText,
        reviewedBodySequence,
        mediaBindings,
        ...(reviewedCoverFingerprint ? { coverFingerprint: reviewedCoverFingerprint } : {}),
      });
      handedOff = true;
    }

    if (submit) {
      console.log('[x-article] Publishing...');
      const publishedUrl = await submitVerifiedXArticle({
        assertCurrent: async () => {
          const current = await waitForSettledComposition();
          if (
            current.snapshot.url !== postPreviewComposition.snapshot.url
            || current.snapshot.editorId !== postPreviewComposition.snapshot.editorId
          ) {
            throw new Error('The X Article editor or draft URL changed after preview.');
          }
          return current.snapshot;
        },
        readPublicationCandidates: () => readXArticlePublicationCandidates(cdp!, sessionId),
        clickPublish: (guard) => clickGuardedXArticlePublish({ cdp: cdp!, sessionId, guard }),
        waitForPublishedUrl: async (preClickCandidates) => {
          const baseline = new Set(preClickCandidates);
          const started = Date.now();
          while (Date.now() - started < 20_000) {
            const candidates = await readXArticlePublicationCandidates(cdp!, sessionId);
            const newlyObserved = candidates.filter((candidate) => !baseline.has(candidate));
            if (newlyObserved.length === 1) return newlyObserved[0];
            if (newlyObserved.length > 1) {
              throw new Error('X exposed ambiguous Article publication evidence.');
            }
            await sleep(500);
          }
          return undefined;
        },
      });
      console.log(`[x-article] Article published: ${publishedUrl}`);
    } else {
      console.log('[x-article] Article composed (draft mode).');
      console.log('[x-article] Browser remains open for manual review.');
    }

  } finally {
    if (cdp && !handedOff) {
      if (options.onComposed && browserResource) {
        await releaseXArticleBrowserResource(browserResource);
      } else {
        // Standalone CLI mode keeps its historical manual-review lifecycle.
        cdp.close();
      }
    }
    if (options.onComposed && !handedOff && ownedChrome) {
      await terminateOwnedXChrome(ownedChrome);
    }
  }
}

function printUsage(): never {
  console.log(`Publish Markdown article to X (Twitter) Articles

Usage:
  npx -y bun x-article.ts <markdown_file> [options]

Options:
  --title <title>     Override title
  --cover <image>     Override cover image
  --submit            Actually publish (default: draft only)
  --profile <dir>     Chrome profile directory
  --help              Show this help

Markdown frontmatter:
  ---
  title: My Article Title
  cover_image: /path/to/cover.jpg
  ---

Example:
  npx -y bun x-article.ts article.md
  npx -y bun x-article.ts article.md --cover ./hero.png
  npx -y bun x-article.ts article.md --submit
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
  let submit = false;
  let profileDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--title' && args[i + 1]) {
      title = args[++i];
    } else if (arg === '--cover' && args[i + 1]) {
      const raw = args[++i]!;
      coverImage = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
    } else if (arg === '--submit') {
      submit = true;
    } else if (arg === '--profile' && args[i + 1]) {
      profileDir = args[++i];
    } else if (!arg.startsWith('-')) {
      markdownPath = arg;
    }
  }

  if (!markdownPath) {
    console.error('Error: Markdown file path required');
    process.exit(1);
  }

  if (!fs.existsSync(markdownPath)) {
    console.error(`Error: File not found: ${markdownPath}`);
    process.exit(1);
  }

  await publishArticle({ markdownPath, title, coverImage, submit, profileDir });
}

if (import.meta.main) {
  await main().catch((err) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
