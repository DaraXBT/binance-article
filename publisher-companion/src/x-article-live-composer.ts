import { rm } from 'node:fs/promises';

import {
  assertXArticleBodyMediaEvidence,
  publishArticle,
  readXArticleEditorSnapshot,
  releaseXArticleBrowserResource,
  xArticleImageFingerprintsMatch,
  type XArticleCompositionContext,
} from '../../.agents/skills/baoyu-post-to-x/scripts/x-article';
import { extractV3PublicationBundle } from './v3-bundle';
import {
  XArticleEligibilityError,
  type PreparedXArticle,
  type XArticleDraft,
  type XArticleDriver,
  type XArticlePublishGuard,
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
const X_ARTICLE_PUBLICATION_CANDIDATES_BROWSER_SOURCE = String.raw`
const xArticleCanonicalPublicationUrl = (value) => {
  if (typeof value !== 'string' || !/^https:\/\/x\.com\/i\/article\/[0-9]+$/.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'x.com'
      && !url.port && !url.username && !url.password && !url.search && !url.hash
      && url.toString() === value ? value : null;
  } catch {
    return null;
  }
};
const xArticlePublicationCandidates = () => {
  const values = [xArticleCanonicalPublicationUrl(window.location.href)];
  const roots = Array.from(document.querySelectorAll(
    '[role="status"], [data-testid="toast"], [data-testid*="toast" i]'
  ));
  for (const root of roots) {
    for (const link of root.querySelectorAll('a[href]')) {
      values.push(xArticleCanonicalPublicationUrl(link.getAttribute('href')));
    }
  }
  return Array.from(new Set(values.filter(Boolean)));
};`;

function strictRawXArticleUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https:\/\/x\.com\/i\/article\/[0-9]+$/.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'x.com'
      && !url.port && !url.username && !url.password && !url.search && !url.hash
      && url.toString() === value ? value : null;
  } catch {
    return null;
  }
}

async function evaluate<T>(context: XArticleCompositionContext, expression: string): Promise<T> {
  const result = await context.cdp.send<{ result: { value: T } }>('Runtime.evaluate', {
    expression,
    returnByValue: true,
  }, { sessionId: context.sessionId });
  return result.result.value;
}

async function readSnapshot(context: XArticleCompositionContext): Promise<XArticleSnapshot> {
  const snapshot = await readXArticleEditorSnapshot(context.cdp, context.sessionId);
  assertXArticleBodyMediaEvidence({
    reviewedSequence: context.reviewedBodySequence,
    renderedSequence: snapshot.bodySequence,
    verifiedAssetBindings: context.mediaBindings,
  });
  const bindingByBlockId = new Map(
    context.mediaBindings.map((binding) => [binding.blockId, binding.assetId]),
  );
  const mediaSources = snapshot.bodySequence
    .filter((token) => token.kind === 'media')
    .map((token) => `${token.blockId}:${bindingByBlockId.get(token.blockId) ?? 'unbound'}`);
  if (
    context.coverFingerprint
    && (
      snapshot.coverMedia.length !== 1
      || !xArticleImageFingerprintsMatch(
        context.coverFingerprint,
        snapshot.coverMedia[0]!.fingerprint,
      )
    )
  ) {
    throw new Error('The X Article cover no longer matches the reviewed asset.');
  }
  const coverSources = context.coverFingerprint
    ? ['reviewed-cover']
    : snapshot.coverSources;
  return {
    url: snapshot.url,
    editorId: snapshot.editorId,
    title: snapshot.title,
    body: snapshot.body,
    imageCount: mediaSources.length,
    mediaSources,
    bodyMediaDomSources: [...snapshot.mediaSources],
    coverSource: coverSources.length === 1 ? coverSources[0]! : null,
    coverSources,
    coverDomSources: [...snapshot.coverSources],
    editorVisible: snapshot.editorVisible,
    publishButtonCount: snapshot.publishButtonCount,
    publishButtonEnabled: snapshot.publishButtonEnabled,
  };
}

async function closeContext(context: XArticleCompositionContext): Promise<void> {
  await releaseXArticleBrowserResource(context);
}

export function createManagedXArticleDraft(
  id: string,
  context: XArticleCompositionContext,
): XArticleDraft {
  let closed = false;
  let preClickPublicationCandidates: ReadonlySet<string> | null = null;
  let mainFrameId: string | null = null;
  let evidenceSettled = false;
  let evidencePollingStarted = false;
  let evidenceTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let evidencePhase: 'idle' | 'armed' | 'clicking' | 'postclick' | 'settled' = 'idle';
  let resolveEvidence: ((value: string | undefined) => void) | null = null;
  let rejectEvidence: ((error: Error) => void) | null = null;
  let evidencePromise: Promise<string | undefined> | null = null;
  let stopNavigationListeners: Array<() => void> = [];
  const pendingNavigationCandidates = new Set<string>();

  const cleanupEvidenceResources = (): void => {
    for (const stopListening of stopNavigationListeners.splice(0)) stopListening();
    if (evidenceTimer) clearTimeout(evidenceTimer);
    if (pollTimer) clearTimeout(pollTimer);
    evidenceTimer = null;
    pollTimer = null;
  };

  const settleEvidence = (value: string | undefined): void => {
    if (evidenceSettled) return;
    evidenceSettled = true;
    evidencePhase = 'settled';
    cleanupEvidenceResources();
    resolveEvidence?.(value);
  };

  const failEvidence = (error: Error): void => {
    if (evidenceSettled) return;
    evidenceSettled = true;
    evidencePhase = 'settled';
    cleanupEvidenceResources();
    rejectEvidence?.(error);
  };

  const recordNavigationCandidate = (value: unknown): void => {
    const candidate = strictRawXArticleUrl(value);
    if (!candidate || evidenceSettled) return;
    if (evidencePhase === 'idle' || evidencePhase === 'armed') return;
    if (evidencePhase === 'clicking' || !preClickPublicationCandidates) {
      pendingNavigationCandidates.add(candidate);
      return;
    }
    if (!preClickPublicationCandidates.has(candidate)) settleEvidence(candidate);
  };

  const armNavigationEvidence = async (): Promise<void> => {
    if (evidencePromise) throw new Error('X Article publication evidence is already armed.');
    evidencePromise = new Promise<string | undefined>((resolve, reject) => {
      resolveEvidence = resolve;
      rejectEvidence = reject;
    });
    try {
      const frameTree = await context.cdp.send<{
        frameTree: { frame: { id: string } };
      }>('Page.getFrameTree', {}, { sessionId: context.sessionId });
      mainFrameId = frameTree.frameTree.frame.id;
      if (!mainFrameId) throw new Error('The managed X Article main frame is unavailable.');
      stopNavigationListeners.push(
        context.cdp.on('Page.frameNavigated', (params, metadata) => {
          if (metadata.sessionId !== context.sessionId) return;
          const event = params as { frame?: { id?: unknown; url?: unknown; parentId?: unknown } };
          if (
            event.frame?.id !== mainFrameId
            || (event.frame.parentId !== undefined && event.frame.parentId !== null)
          ) return;
          recordNavigationCandidate(event.frame.url);
        }),
      );
      stopNavigationListeners.push(
        context.cdp.on('Page.navigatedWithinDocument', (params, metadata) => {
          if (metadata.sessionId !== context.sessionId) return;
          const event = params as { frameId?: unknown; url?: unknown };
          if (event.frameId !== mainFrameId) return;
          recordNavigationCandidate(event.url);
        }),
      );
      evidencePhase = 'armed';
    } catch (error) {
      settleEvidence(undefined);
      throw error;
    }
  };

  const startEvidenceTimeout = (): void => {
    if (evidenceSettled || evidenceTimer) return;
    evidenceTimer = setTimeout(() => settleEvidence(undefined), EVIDENCE_TIMEOUT_MS);
  };

  const scheduleDomPoll = (): void => {
    if (evidenceSettled || closed) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void pollDomEvidence();
    }, 500);
  };

  const pollDomEvidence = async (): Promise<void> => {
    if (evidenceSettled || closed || !preClickPublicationCandidates) return;
    try {
      const candidates = await evaluate<string[]>(context, `(() => {
        ${X_ARTICLE_PUBLICATION_CANDIDATES_BROWSER_SOURCE}
        return xArticlePublicationCandidates();
      })()`);
      if (evidenceSettled || closed) return;
      const newCandidates = candidates.filter((candidate) => (
        strictRawXArticleUrl(candidate) === candidate
        && !preClickPublicationCandidates!.has(candidate)
      ));
      if (newCandidates.length === 1) {
        settleEvidence(newCandidates[0]);
        return;
      }
      if (newCandidates.length > 1) {
        failEvidence(new Error('X exposed ambiguous new Article publication evidence.'));
        return;
      }
    } catch {
      // Top-level navigation can temporarily destroy the default execution context.
      // Keep the already-armed navigation listeners active and retry until timeout.
    }
    scheduleDomPoll();
  };

  return {
    id,
    snapshot: () => readSnapshot(context),
    clickPublish: async (guard: XArticlePublishGuard) => {
      if (closed) throw new Error('The managed X Article draft is already closed.');
      await armNavigationEvidence();
      let result: {
        clicked: boolean;
        guardMatched: boolean;
        baselineCandidates: string[];
      };
      try {
        evidencePhase = 'clicking';
        result = await evaluate(context, `(() => {
        ${X_ARTICLE_PUBLICATION_CANDIDATES_BROWSER_SOURCE}
        const baselineCandidates = xArticlePublicationCandidates();
        const visible = (element) => {
          if (!element || element.closest('[role="dialog"][aria-modal="true"]')) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0
            && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const same = (left, right) => left.length === right.length
          && left.every((value, index) => value === right[index]);
        const expected = ${JSON.stringify(guard)};
        const titles = Array.from(new Set(${JSON.stringify(TITLE_SELECTORS)}.flatMap((selector) =>
          Array.from(document.querySelectorAll(selector))
        ))).filter(visible);
        const bodies = Array.from(document.querySelectorAll(
          '.DraftEditor-editorContainer [data-contents="true"]'
        )).filter(visible);
        if (titles.length !== 1 || bodies.length !== 1) {
          return { clicked: false, guardMatched: false, baselineCandidates };
        }
        const title = titles[0];
        const body = bodies[0];
        let root = title.closest('main, [role="main"], form');
        if (!root || !root.contains(body)) {
          root = title.parentElement;
          while (root && !root.contains(body)) root = root.parentElement;
        }
        if (!root) return { clicked: false, guardMatched: false, baselineCandidates };

        const blocks = Array.from(body.querySelectorAll('[data-block="true"]'))
          .filter((block) => !block.parentElement?.closest('[data-block="true"]'));
        const blockOwnerIds = blocks.map((block) => block.getAttribute('data-editor'));
        if (blockOwnerIds.some((ownerEditorId) => !ownerEditorId)) {
          return { clicked: false, guardMatched: false, baselineCandidates };
        }
        const editorIds = Array.from(new Set(blockOwnerIds));
        if (editorIds.length !== 1 || editorIds[0] !== expected.editorId) {
          return { clicked: false, guardMatched: false, baselineCandidates };
        }
        const bindingByBlockId = new Map(${JSON.stringify(
          context.mediaBindings.map((binding) => [binding.blockId, binding.assetId]),
        )});
        const mediaSources = [];
        const bodyMediaDomSources = [];
        const mediaBlockIds = new Set();
        const accountedBodyImages = new Set();
        for (const block of blocks.filter((candidate) => candidate.getAttribute('data-editor') === expected.editorId)) {
          const images = Array.from(block.querySelectorAll('img')).filter(visible);
          if (images.length === 0) continue;
          const text = block.innerText || block.textContent || '';
          if (images.length !== 1 || text.replace(/\\s+/g, ' ').trim()) {
            return { clicked: false, guardMatched: false, baselineCandidates };
          }
          const offsetKey = block.getAttribute('data-offset-key')
            || block.querySelector('[data-offset-key]')?.getAttribute('data-offset-key') || '';
          const blockId = offsetKey.match(/^(.+)-\\d+-\\d+$/)?.[1] || '';
          const assetId = bindingByBlockId.get(blockId);
          if (!blockId || !assetId || mediaBlockIds.has(blockId)) {
            return { clicked: false, guardMatched: false, baselineCandidates };
          }
          mediaBlockIds.add(blockId);
          accountedBodyImages.add(images[0]);
          mediaSources.push(blockId + ':' + assetId);
          bodyMediaDomSources.push(images[0].currentSrc || images[0].src || '');
        }
        const visibleBodyImages = Array.from(body.querySelectorAll('img')).filter(visible);
        if (visibleBodyImages.length !== accountedBodyImages.size
          || visibleBodyImages.some((image) => !accountedBodyImages.has(image))) {
          return { clicked: false, guardMatched: false, baselineCandidates };
        }
        const coverDomSources = Array.from(root.querySelectorAll(
          '[data-testid*="cover" i] img, [data-testid*="headerMedia" i] img'
        )).filter(visible).map((image) => image.currentSrc || image.src || '').filter(Boolean);
        const coverSources = ${Boolean(context.coverFingerprint)}
          ? (coverDomSources.length === 1 ? ['reviewed-cover'] : coverDomSources)
          : coverDomSources;
        const buttons = Array.from(new Set(${JSON.stringify(PUBLISH_SELECTORS)}.flatMap((selector) =>
          Array.from(root.querySelectorAll(selector))
        ))).filter(visible);
        const button = buttons.length === 1 ? buttons[0] : null;
        const titleValue = title.value || title.innerText || title.textContent || '';
        const bodyValue = body.innerText || body.textContent || '';
        const guardMatched = window.location.href === expected.url
          && titleValue === expected.title && bodyValue === expected.body
          && same(mediaSources, expected.mediaSources)
          && (!expected.bodyMediaDomSources
            || same(bodyMediaDomSources, expected.bodyMediaDomSources))
          && same(coverSources, expected.coverSources)
          && (!expected.coverDomSources || same(coverDomSources, expected.coverDomSources))
          && expected.editorVisible === true
          && expected.publishButtonCount === 1 && expected.publishButtonEnabled === true
          && buttons.length === 1 && button && !button.disabled
          && button.getAttribute('aria-disabled') !== 'true';
        if (!guardMatched) return { clicked: false, guardMatched: false, baselineCandidates };
        button.click();
        return { clicked: true, guardMatched: true, baselineCandidates };
        })()`);
      } catch (error) {
        settleEvidence(undefined);
        throw error;
      }
      preClickPublicationCandidates = new Set(
        result.baselineCandidates.filter((candidate) => strictRawXArticleUrl(candidate) === candidate),
      );
      if (!result.guardMatched) {
        settleEvidence(undefined);
        throw new Error('The X Article changed between final verification and the Publish click.');
      }
      evidencePhase = 'postclick';
      for (const candidate of pendingNavigationCandidates) recordNavigationCandidate(candidate);
      pendingNavigationCandidates.clear();
      if (!result.clicked) {
        settleEvidence(undefined);
        return false;
      }
      startEvidenceTimeout();
      return result.clicked;
    },
    waitForPublishedUrl: async () => {
      if (!preClickPublicationCandidates || !evidencePromise) {
        throw new Error('X Article publication evidence was requested before the Publish click.');
      }
      if (!evidencePollingStarted && !evidenceSettled) {
        evidencePollingStarted = true;
        void pollDomEvidence();
      }
      return evidencePromise;
    },
    close: async () => {
      if (closed) return;
      closed = true;
      settleEvidence(undefined);
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

export function mapReviewedXArticleExpectations(
  context: Pick<XArticleCompositionContext, 'body' | 'expectedBody'>,
  reviewed: { title?: string; imageCount: number; coverPresent: boolean },
): Omit<PreparedXArticle, 'draft'> {
  return {
    expectedTitle: reviewed.title ?? '',
    expectedBody: context.expectedBody,
    expectedImageCount: reviewed.imageCount,
    expectedCover: reviewed.coverPresent,
  };
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
        const draft = createManagedXArticleDraft(crypto.randomUUID(), context);
        const prepared: PreparedXArticle = {
          draft,
          ...mapReviewedXArticleExpectations(context, {
            title: extracted.title,
            imageCount: extracted.imagePaths.length,
            coverPresent: Boolean(extracted.coverPath),
          }),
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
