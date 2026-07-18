import fs from 'node:fs/promises';
import path from 'node:path';

import {
  extractValidatedBundle,
  sha256Text,
  validateExtractedBundle,
  type BundleManifestV1,
} from './bundle.js';
import {
  createDraftState,
  getDraftCacheRoot,
  isDraftBundlePathSafe,
  readDraftState,
  removeDraftState,
  validateDraftForPublish,
  type DraftState,
} from './draft-state.js';
import { publishArticle, type ArticleCompositionContext } from './binance-article.js';
import {
  BS_SELECTORS,
  CdpConnection,
  findExistingChromeDebugPort,
  getDefaultProfileDir,
  resolveSelector,
  sleep,
  waitForChromeDebugPort,
} from './binance-utils.js';
import { evaluatePublishEvidence } from './publish-safety.js';

export interface BundlePrepareOptions {
  bundlePath: string;
  profileDir?: string;
  chromePath?: string;
  dryRun?: boolean;
}

export interface DryRunResult {
  valid: true;
  articleId: string;
  title: string;
  characterCount: number;
  imageCount: number;
  coverPath: string;
  warnings: string[];
}

function assetHashes(manifest: BundleManifestV1): string[] {
  return [manifest.cover.sha256, ...[...manifest.images].sort((a, b) => a.order - b.order).map((image) => image.sha256)];
}

function normalizeEditorText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

async function createStateFromComposition(
  extracted: Awaited<ReturnType<typeof extractValidatedBundle>>,
  profileDir: string,
  context: ArticleCompositionContext,
): Promise<DraftState & { statePath: string }> {
  return await createDraftState({
    cacheRoot: getDraftCacheRoot(),
    profileDir,
    debugPort: context.debugPort,
    targetId: context.targetId,
    editorUrl: context.editorUrl,
    titleHash: context.titleHash,
    bodyHash: context.bodyHash,
    assetHashes: assetHashes(extracted.manifest),
    bundleDir: extracted.bundleDir,
  });
}

export async function dryRunBundle(bundlePath: string): Promise<DryRunResult> {
  const validated = await (await import('./bundle.js')).validateBundleArchive(bundlePath);
  return {
    valid: true,
    articleId: validated.manifest.articleId,
    title: validated.manifest.title,
    characterCount: [...validated.markdown].length,
    imageCount: validated.manifest.images.length,
    coverPath: validated.manifest.cover.path,
    warnings: validated.manifest.images.length === 0 ? ['The article contains no body images.'] : [],
  };
}

export async function prepareBundle(options: BundlePrepareOptions): Promise<DraftState | DryRunResult> {
  if (options.dryRun) return await dryRunBundle(options.bundlePath);
  const profileDir = options.profileDir ?? getDefaultProfileDir();
  const cacheRoot = getDraftCacheRoot();
  const extracted = await extractValidatedBundle(options.bundlePath, {
    outputRoot: path.join(cacheRoot, 'bundles'),
  });
  let state: (DraftState & { statePath: string }) | null = null;
  try {
    await publishArticle({
      markdownPath: extracted.markdownPath,
      coverImage: extracted.coverPath,
      title: extracted.manifest.title,
      profileDir,
      chromePath: options.chromePath,
      hashtags: true,
      coinTags: true,
      submit: false,
      onComposed: async (context) => {
        state = await createStateFromComposition(extracted, profileDir, context);
      },
    });
  } catch (error) {
    if (!state) await fs.rm(extracted.bundleDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  if (!state) {
    await fs.rm(extracted.bundleDir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error('The article was composed but no review state was created.');
  }
  return state;
}

interface EditorSnapshot {
  url: string;
  title: string;
  body: string;
  imageCount: number;
  editorVisible: boolean;
  successToast: boolean;
}

async function readEditorSnapshot(
  cdp: CdpConnection,
  sessionId: string,
  titleSelector: string,
  editorSelector: string,
): Promise<EditorSnapshot> {
  const result = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
    expression: `(() => {
      const title = document.querySelector(${JSON.stringify(titleSelector)});
      const editor = document.querySelector(${JSON.stringify(editorSelector)});
      const bodyText = document.body?.innerText || '';
      return JSON.stringify({
        url: window.location.href,
        title: title?.value || title?.textContent || '',
        body: editor?.innerText || '',
        imageCount: editor?.querySelectorAll('img').length || 0,
        editorVisible: Boolean(editor && (() => { const r = editor.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()),
        successToast: /(published successfully|article published|发布成功|已发布)/i.test(bodyText),
      });
    })()`,
    returnByValue: true,
  }, { sessionId });
  return JSON.parse(result.result.value) as EditorSnapshot;
}

async function attachToDraftTarget(cdp: CdpConnection, targetId: string): Promise<string> {
  const attached = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Target.activateTarget', { targetId });
  await cdp.send('Runtime.enable', {}, { sessionId: attached.sessionId });
  await cdp.send('Page.enable', {}, { sessionId: attached.sessionId });
  await cdp.send('DOM.enable', {}, { sessionId: attached.sessionId });
  return attached.sessionId;
}

async function clickScopedPublishButton(cdp: CdpConnection, sessionId: string): Promise<boolean> {
  const result = await cdp.send<{ result: { value: boolean } }>('Runtime.evaluate', {
    expression: `(() => {
      const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      for (const selector of ${JSON.stringify(BS_SELECTORS.articlePublishButton)}) {
        const button = document.querySelector(selector);
        if (button && visible(button) && !button.disabled) { button.click(); return true; }
      }
      const roots = Array.from(document.querySelectorAll('.article-editor, [data-testid*="article-editor" i], [role="dialog"]'));
      for (const root of roots) {
        const button = Array.from(root.querySelectorAll('button')).find((candidate) =>
          visible(candidate) && !candidate.disabled && /^(publish|publish article|发布|发布文章)$/i.test((candidate.textContent || '').trim())
        );
        if (button) { button.click(); return true; }
      }
      return false;
    })()`,
    returnByValue: true,
  }, { sessionId });
  return result.result.value;
}

export async function publishPreparedDraft(
  draftId: string,
  options: { profileDir?: string } = {},
): Promise<{ verified: true; reason: string }> {
  const state = await readDraftState(draftId);
  if (!isDraftBundlePathSafe(state.bundleDir)) {
    throw new Error('Prepared bundle is outside the local draft cache.');
  }
  const extracted = await validateExtractedBundle(state.bundleDir);
  const expectedAssets = assetHashes(extracted.manifest);
  const profileDir = options.profileDir ?? state.profileDir;
  if (expectedAssets.length !== state.assetHashes.length || expectedAssets.some((hash, index) => hash !== state.assetHashes[index])) {
    throw new Error('Prepared bundle assets changed; prepare the draft again.');
  }

  const existingPort = await findExistingChromeDebugPort(profileDir);
  const port = existingPort ?? state.debugPort;
  const wsUrl = await waitForChromeDebugPort(port, 5_000, { includeLastError: true });
  const cdp = await CdpConnection.connect(wsUrl, 30_000, { defaultTimeoutMs: 15_000 });
  let sessionId: string | null = null;
  try {
    sessionId = await attachToDraftTarget(cdp, state.targetId);
    const titleSelector = await resolveSelector(cdp, sessionId, BS_SELECTORS.articleTitleInput);
    const editorSelector = await resolveSelector(cdp, sessionId, BS_SELECTORS.articleEditor);
    if (!titleSelector || !editorSelector) throw new Error('The prepared Binance editor is no longer open.');
    const before = await readEditorSnapshot(cdp, sessionId, titleSelector, editorSelector);
    validateDraftForPublish(state, {
      editorUrl: before.url,
      titleHash: sha256Text(normalizeEditorText(before.title)),
      bodyHash: sha256Text(normalizeEditorText(before.body)),
      assetHashes: expectedAssets,
    });
    if (before.imageCount !== extracted.manifest.images.length) {
      throw new Error(`The reviewed editor has ${before.imageCount} body images; expected ${extracted.manifest.images.length}.`);
    }
    if (!(await clickScopedPublishButton(cdp, sessionId))) {
      throw new Error('The scoped Binance Publish button was not found.');
    }

    const started = Date.now();
    while (Date.now() - started < 20_000) {
      await sleep(750);
      const after = await readEditorSnapshot(cdp, sessionId, titleSelector, editorSelector);
      const evidence = evaluatePublishEvidence({
        beforeUrl: before.url,
        afterUrl: after.url,
        successToast: after.successToast,
        editorVisible: after.editorVisible,
      });
      if (evidence.verified) {
        await removeDraftState(draftId);
        await fs.rm(state.bundleDir, { recursive: true, force: true }).catch(() => undefined);
        return { verified: true, reason: evidence.reason };
      }
    }
    throw new Error('Publish was clicked, but Binance did not expose a verifiable success state.');
  } finally {
    cdp.close();
  }
}
