import { rm } from 'node:fs/promises';

import {
  publishArticle,
  releaseXArticleBrowserResource,
  type XArticleCompositionContext,
} from '../../.agents/skills/baoyu-post-to-x/scripts/x-article';
import { sleep } from '../../.agents/skills/baoyu-post-to-x/scripts/x-utils';

import { extractV3PublicationBundle } from './v3-bundle';
import {
  XArticleEligibilityError,
  type PreparedXArticle,
  type XArticleDraft,
  type XArticleDriver,
  type XArticleSnapshot,
} from './x-article-adapter';

const EVIDENCE_TIMEOUT_MS = 20_000;
const TITLE_SELECTORS = [
  'textarea[placeholder="Add a title"]',
  'textarea[placeholder="添加标题"]',
  'textarea[placeholder="タイトルを追加"]',
  'textarea[placeholder="제목 추가"]',
  'textarea[name="Article Title"]',
];
const PUBLISH_SELECTORS = [
  '[data-testid="publishButton"]',
  'button[aria-label*="publish" i]',
  'button[aria-label*="发布" i]',
  'button[aria-label*="公開" i]',
  'button[aria-label*="게시" i]',
];

async function evaluate<T>(context: XArticleCompositionContext, expression: string): Promise<T> {
  const result = await context.cdp.send<{ result: { value: T } }>('Runtime.evaluate', {
    expression,
    returnByValue: true,
  }, { sessionId: context.sessionId });
  return result.result.value;
}

async function readSnapshot(context: XArticleCompositionContext): Promise<XArticleSnapshot> {
  const serialized = await evaluate<string>(context, `(() => {
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const titleSelectors = ${JSON.stringify(TITLE_SELECTORS)};
    let titleElement = null;
    for (const selector of titleSelectors) {
      const candidate = document.querySelector(selector);
      if (candidate) { titleElement = candidate; break; }
    }
    const body = document.querySelector('.DraftEditor-editorContainer [data-contents="true"]');
    const bodyMedia = Array.from(document.querySelectorAll(
      'section[data-block="true"][contenteditable="false"] img[src^="blob:"]'
    )).filter(visible);
    const cover = document.querySelector('[data-testid*="cover" i] img, [data-testid*="headerMedia" i] img');
    const buttons = Array.from(new Set(${JSON.stringify(PUBLISH_SELECTORS)}.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector)).filter(visible)
    )));
    const button = buttons.length === 1 ? buttons[0] : null;
    return JSON.stringify({
      url: window.location.href,
      title: titleElement ? (titleElement.value || titleElement.innerText || titleElement.textContent || '') : '',
      body: body?.innerText || body?.textContent || '',
      imageCount: bodyMedia.length,
      mediaSources: bodyMedia.map((image) => image.currentSrc || image.src || ''),
      coverSource: cover && visible(cover) ? (cover.currentSrc || cover.src || '') : null,
      editorVisible: Boolean(body),
      publishButtonCount: buttons.length,
      publishButtonEnabled: Boolean(button && !button.disabled && button.getAttribute('aria-disabled') !== 'true'),
    });
  })()`);
  return JSON.parse(serialized) as XArticleSnapshot;
}

async function closeContext(context: XArticleCompositionContext): Promise<void> {
  await releaseXArticleBrowserResource(context);
}

function browserDraft(id: string, context: XArticleCompositionContext): XArticleDraft {
  let closed = false;
  return {
    id,
    snapshot: () => readSnapshot(context),
    clickPublish: () => evaluate<boolean>(context, `(() => {
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const buttons = Array.from(new Set(${JSON.stringify(PUBLISH_SELECTORS)}.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector)).filter((button) =>
          visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true'
        )
      )));
      if (buttons.length !== 1) return false;
      buttons[0].click();
      return true;
    })()`),
    waitForPublishedUrl: async () => {
      const started = Date.now();
      while (Date.now() - started < EVIDENCE_TIMEOUT_MS) {
        const candidates = await evaluate<string[]>(context, `(() => {
          const canonical = (value) => {
            try {
              const url = new URL(value, window.location.href);
              const parts = url.pathname.split('/');
              return url.protocol === 'https:' && url.hostname === 'x.com'
                && !url.port && !url.search && !url.hash
                && parts.length === 4 && parts[1] === 'i'
                && parts[2] === 'article' && /^[0-9]+$/.test(parts[3] || '')
                ? url.toString() : null;
            } catch { return null; }
          };
          const values = [canonical(window.location.href)];
          const roots = Array.from(document.querySelectorAll(
            '[role="status"], [data-testid="toast"], [data-testid*="toast" i]'
          ));
          for (const root of roots) {
            for (const link of root.querySelectorAll('a[href]')) values.push(canonical(link.href));
          }
          return Array.from(new Set(values.filter(Boolean)));
        })()`);
        if (candidates.length === 1) return candidates[0];
        await sleep(500);
      }
      return undefined;
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await closeContext(context);
    },
  };
}

function eligibilityError(error: unknown): XArticleEligibilityError | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return code === 'X_LOGIN_REQUIRED' || code === 'X_ARTICLES_UNAVAILABLE'
    ? new XArticleEligibilityError(code)
    : null;
}

export function createLiveXArticleDriver(): XArticleDriver {
  return {
    async prepare(bundlePath: string): Promise<PreparedXArticle> {
      const extracted = await extractV3PublicationBundle(bundlePath, { target: 'x', kind: 'article' });
      const contextBox: { value: XArticleCompositionContext | null } = { value: null };
      try {
        await publishArticle({
          markdownPath: extracted.contentPath,
          title: extracted.title,
          ...(extracted.coverPath ? { coverImage: extracted.coverPath } : {}),
          inferCoverFromFirstImage: false,
          submit: false,
          onComposed: (composed) => { contextBox.value = composed; },
        });
        const context = contextBox.value;
        if (!context) throw new Error('The X Article was composed without a review session.');
        if (
          context.imageCount !== extracted.imagePaths.length
          || context.coverPresent !== Boolean(extracted.coverPath)
        ) {
          throw new Error('The X Article media snapshot does not match the reviewed bundle.');
        }
        const draft = browserDraft(crypto.randomUUID(), context);
        const prepared: PreparedXArticle = {
          draft,
          expectedTitle: extracted.title ?? '',
          expectedBody: context.expectedBody,
          expectedImageCount: extracted.imagePaths.length,
          expectedCover: Boolean(extracted.coverPath),
        };
        contextBox.value = null;
        return prepared;
      } catch (error) {
        const stable = eligibilityError(error);
        if (stable) throw stable;
        throw error;
      } finally {
        await rm(extracted.bundleDir, { recursive: true, force: true }).catch(() => undefined);
        if (contextBox.value) await closeContext(contextBox.value).catch(() => undefined);
      }
    },
  };
}
