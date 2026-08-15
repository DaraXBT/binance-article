import fs from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';

import {
  BS_BASE_URL,
  BS_SELECTORS,
  CdpConnection,
  copyImageToClipboard,
  getDefaultProfileDir,
  launchChrome,
  pasteFromClipboard,
  sleep,
  waitForChromeDebugPort,
} from '../../.agents/skills/baoyu-post-to-binance-square/scripts/binance-utils';

import { extractV3PublicationBundle } from './v3-bundle';
import type {
  BinancePostDraft,
  BinancePostDriver,
  BinancePostSnapshot,
  PreparedBinancePost,
} from './binance-post-adapter';

const EDITOR_TIMEOUT_MS = 120_000;
const EVIDENCE_TIMEOUT_MS = 20_000;

type PageSession = {
  cdp: CdpConnection;
  sessionId: string;
  targetId: string;
  chrome: Awaited<ReturnType<typeof launchChrome>>['chrome'];
  port: number;
};

async function evaluate<T>(session: PageSession, expression: string): Promise<T> {
  const result = await session.cdp.send<{ result: { value: T } }>('Runtime.evaluate', {
    expression,
    returnByValue: true,
  }, { sessionId: session.sessionId });
  return result.result.value;
}

async function readSnapshot(session: PageSession): Promise<BinancePostSnapshot> {
  const serialized = await evaluate<string>(session, `(() => {
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const selectors = ${JSON.stringify(BS_SELECTORS.composeTextarea)};
    const editors = Array.from(new Set(selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector)).filter(visible)
    )));
    const editor = editors.length === 1 ? editors[0] : null;
    const root = editor?.closest('[role="dialog"]') || editor?.closest('form') || editor?.parentElement;
    const buttonSelectors = ${JSON.stringify(BS_SELECTORS.publishButton)};
    const buttons = root ? Array.from(new Set(buttonSelectors.flatMap((selector) =>
      Array.from(root.querySelectorAll(selector)).filter(visible)
    ))) : [];
    const media = root ? Array.from(new Set(Array.from(root.querySelectorAll(
      'img[src^="blob:"], [data-testid*="upload" i] img, [data-testid*="media" i] img'
    )))).filter(visible) : [];
    const button = buttons.length === 1 ? buttons[0] : null;
    return JSON.stringify({
      url: window.location.href,
      text: editor ? ('value' in editor ? editor.value : editor.innerText || editor.textContent || '') : '',
      imageCount: media.length,
      mediaSources: media.map((image) => image.currentSrc || image.src || ''),
      editorVisible: Boolean(editor),
      publishButtonCount: buttons.length,
      publishButtonEnabled: Boolean(button && !button.disabled && button.getAttribute('aria-disabled') !== 'true'),
    });
  })()`);
  return JSON.parse(serialized) as BinancePostSnapshot;
}

async function waitForEditor(session: PageSession): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < EDITOR_TIMEOUT_MS) {
    if ((await readSnapshot(session)).editorVisible) return;
    await sleep(500);
  }
  throw new Error('Timed out waiting for the Binance Square composer. Log in and try again.');
}

function normalizedText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trim();
}

async function waitForReady(
  session: PageSession,
  expected: { text: string; imageCount: number },
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const snapshot = await readSnapshot(session);
    if (
      snapshot.editorVisible
      && normalizedText(snapshot.text) === normalizedText(expected.text)
      && snapshot.imageCount === expected.imageCount
      && snapshot.publishButtonCount === 1
      && snapshot.publishButtonEnabled
    ) {
      return;
    }
    await sleep(500);
  }
  throw new Error('The Binance post composer did not reach the reviewed ready state.');
}

async function replaceText(session: PageSession, text: string): Promise<void> {
  const changed = await evaluate<boolean>(session, `(() => {
    const visible = (element) => element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
    const selectors = ${JSON.stringify(BS_SELECTORS.composeTextarea)};
    const editors = Array.from(new Set(selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector)).filter(visible)
    )));
    if (editors.length !== 1) return false;
    const editor = editors[0];
    editor.focus();
    if ('value' in editor) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), 'value')?.set;
      if (setter) setter.call(editor, ${JSON.stringify(text)}); else editor.value = ${JSON.stringify(text)};
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false);
      document.execCommand('delete', false);
      if (${JSON.stringify(text)} !== '') document.execCommand('insertText', false, ${JSON.stringify(text)});
    }
    return true;
  })()`);
  if (!changed) throw new Error('The Binance post composer could not be filled.');
  await sleep(300);
}

async function uploadImage(session: PageSession, imagePath: string): Promise<void> {
  if (!fs.existsSync(imagePath) || !copyImageToClipboard(imagePath)) {
    throw new Error('A Binance post image could not be prepared for upload.');
  }
  const before = (await readSnapshot(session)).imageCount;
  await evaluate(session, `(() => {
    const selectors = ${JSON.stringify(BS_SELECTORS.composeTextarea)};
    for (const selector of selectors) {
      const editor = document.querySelector(selector);
      if (editor) { editor.focus(); return true; }
    }
    return false;
  })()`);
  await sleep(150);
  if (!pasteFromClipboard('Google Chrome', 5, 500)) {
    throw new Error('A Binance post image could not be pasted into Chrome.');
  }
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if ((await readSnapshot(session)).imageCount === before + 1) return;
    await sleep(500);
  }
  throw new Error('The Binance post composer did not finish uploading an image.');
}

async function closeSession(session: PageSession): Promise<void> {
  try {
    await session.cdp.send('Browser.close', {}, { timeoutMs: 5_000 });
  } catch {
    // The user may already have closed the review browser.
  }
  session.cdp.close();
  if (!session.chrome.killed) {
    try { session.chrome.kill('SIGTERM'); } catch {}
  }
}

async function launchComposer(): Promise<PageSession> {
  const profileDir = getDefaultProfileDir();
  await mkdir(profileDir, { recursive: true });
  const launched = await launchChrome(BS_BASE_URL, profileDir);
  try {
    const wsUrl = await waitForChromeDebugPort(launched.port, 30_000, { includeLastError: true });
    const cdp = await CdpConnection.connect(wsUrl, 30_000, { defaultTimeoutMs: 15_000 });
    const targets = await cdp.send<{
      targetInfos: Array<{ targetId: string; url: string; type: string }>;
    }>('Target.getTargets');
    let target = targets.targetInfos.find((candidate) => (
      candidate.type === 'page' && candidate.url.includes('binance.com')
    ));
    if (!target) {
      const created = await cdp.send<{ targetId: string }>('Target.createTarget', { url: BS_BASE_URL });
      target = { targetId: created.targetId, url: BS_BASE_URL, type: 'page' };
    }
    const attached = await cdp.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    const session = {
      cdp,
      sessionId: attached.sessionId,
      targetId: target.targetId,
      chrome: launched.chrome,
      port: launched.port,
    };
    await cdp.send('Target.activateTarget', { targetId: target.targetId });
    await cdp.send('Page.enable', {}, { sessionId: session.sessionId });
    await cdp.send('Runtime.enable', {}, { sessionId: session.sessionId });
    await cdp.send('Input.setIgnoreInputEvents', { ignore: false }, { sessionId: session.sessionId });
    return session;
  } catch (error) {
    if (!launched.chrome.killed) {
      try { launched.chrome.kill('SIGTERM'); } catch {}
    }
    throw error;
  }
}

function browserDraft(id: string, session: PageSession): BinancePostDraft {
  let closed = false;
  return {
    id,
    snapshot: () => readSnapshot(session),
    clickPublish: () => evaluate<boolean>(session, `(() => {
      const visible = (element) => element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
      const editorSelectors = ${JSON.stringify(BS_SELECTORS.composeTextarea)};
      const editors = Array.from(new Set(editorSelectors.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector)).filter(visible)
      )));
      if (editors.length !== 1) return false;
      const root = editors[0].closest('[role="dialog"]') || editors[0].closest('form') || editors[0].parentElement;
      if (!root) return false;
      const buttonSelectors = ${JSON.stringify(BS_SELECTORS.publishButton)};
      const buttons = Array.from(new Set(buttonSelectors.flatMap((selector) =>
        Array.from(root.querySelectorAll(selector)).filter((button) =>
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
        const candidate = await evaluate<string | null>(session, `(() => {
          const canonical = (value) => {
            try {
              const url = new URL(value, window.location.href);
              const parts = url.pathname.split('/').filter(Boolean);
              const square = parts.indexOf('square');
              return url.protocol === 'https:'
                && (url.hostname === 'binance.com' || url.hostname === 'www.binance.com')
                && !url.port && !url.search && !url.hash
                && square === parts.length - 3 && parts[square + 1] === 'post'
                && /^[A-Za-z0-9_-]+$/.test(parts[square + 2] || '')
                ? url.toString() : null;
            } catch { return null; }
          };
          return canonical(window.location.href);
        })()`);
        if (candidate) return candidate;
        await sleep(500);
      }
      return undefined;
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await closeSession(session);
    },
  };
}

export function createLiveBinancePostDriver(): BinancePostDriver {
  return {
    async prepare(bundlePath: string): Promise<PreparedBinancePost> {
      const extracted = await extractV3PublicationBundle(bundlePath, {
        target: 'binance-square', kind: 'post',
      });
      let session: PageSession | null = null;
      try {
        session = await launchComposer();
        await waitForEditor(session);
        if ((await readSnapshot(session)).imageCount !== 0) {
          throw new Error('The Binance post composer contains media from an earlier draft.');
        }
        await replaceText(session, extracted.content);
        for (const imagePath of extracted.imagePaths) await uploadImage(session, imagePath);
        await waitForReady(session, {
          text: extracted.content,
          imageCount: extracted.imagePaths.length,
        });
        const draft = browserDraft(crypto.randomUUID(), session);
        session = null;
        return {
          draft,
          expectedText: extracted.content,
          expectedImageCount: extracted.imagePaths.length,
        };
      } finally {
        await rm(extracted.bundleDir, { recursive: true, force: true }).catch(() => undefined);
        if (session) await closeSession(session).catch(() => undefined);
      }
    },
  };
}
