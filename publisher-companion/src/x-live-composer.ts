import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';

import {
  CHROME_CANDIDATES_FULL,
  CdpConnection,
  copyImageToClipboard,
  findChromeExecutable,
  getDefaultProfileDir,
  getFreePort,
  pasteFromClipboard,
  sleep,
  waitForChromeDebugPort,
} from '../../.agents/skills/baoyu-post-to-x/scripts/x-utils';

import { extractXPublicationBundle } from './x-bundle';
import type {
  PreparedXComposerDraft,
  XComposerDraft,
  XComposerDriver,
  XComposerSnapshot,
} from './x-adapter';

const X_COMPOSE_URL = 'https://x.com/compose/post';
const EDITOR_TIMEOUT_MS = 120_000;
const PUBLISH_EVIDENCE_TIMEOUT_MS = 20_000;

type PageSession = {
  cdp: CdpConnection;
  sessionId: string;
  targetId: string;
  chrome: ChildProcess;
};

async function evaluate<T>(
  session: PageSession,
  expression: string,
): Promise<T> {
  const result = await session.cdp.send<{ result: { value: T } }>('Runtime.evaluate', {
    expression,
    returnByValue: true,
  }, { sessionId: session.sessionId });
  return result.result.value;
}

async function readSnapshot(session: PageSession): Promise<XComposerSnapshot> {
  const serialized = await evaluate<string>(session, `(() => {
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const editors = Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"]')).filter(visible);
    const editor = editors.length === 1 ? editors[0] : null;
    const root = editor?.closest('[role="dialog"]') || editor?.closest('form') || editor?.parentElement;
    const buttons = root
      ? Array.from(root.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')).filter(visible)
      : [];
    const media = root
      ? Array.from(new Set(Array.from(root.querySelectorAll(
          '[data-testid="attachments"] img, [data-testid="tweetPhoto"] img, img[src^="blob:"]'
        )))).filter(visible)
      : [];
    const button = buttons.length === 1 ? buttons[0] : null;
    return JSON.stringify({
      url: window.location.href,
      text: editor?.innerText || editor?.textContent || '',
      imageCount: media.length,
      mediaSources: media.map((image) => image.currentSrc || image.src || ''),
      editorVisible: Boolean(editor && visible(editor)),
      postButtonCount: buttons.length,
      postButtonEnabled: Boolean(button && !button.disabled && button.getAttribute('aria-disabled') !== 'true'),
    });
  })()`);
  return JSON.parse(serialized) as XComposerSnapshot;
}

async function waitForEditor(session: PageSession): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < EDITOR_TIMEOUT_MS) {
    if ((await readSnapshot(session)).editorVisible) return;
    await sleep(500);
  }
  throw new Error('Timed out waiting for the X composer. Log in to X and try again.');
}

async function replaceComposerText(session: PageSession, text: string): Promise<void> {
  const changed = await evaluate<boolean>(session, `(() => {
    const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
    if (!editor) return false;
    editor.focus();
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    if (${JSON.stringify(text)} !== '') {
      document.execCommand('insertText', false, ${JSON.stringify(text)});
    }
    return true;
  })()`);
  if (!changed) throw new Error('The X composer could not be filled.');
  await sleep(300);
}

async function uploadImage(session: PageSession, imagePath: string): Promise<void> {
  if (!fs.existsSync(imagePath) || !copyImageToClipboard(imagePath)) {
    throw new Error('An X draft image could not be prepared for upload.');
  }
  const before = (await readSnapshot(session)).imageCount;
  await evaluate(session, `document.querySelector('[data-testid="tweetTextarea_0"]')?.focus()`);
  await sleep(150);
  if (!pasteFromClipboard('Google Chrome', 5, 500)) {
    throw new Error('An X draft image could not be pasted into Chrome.');
  }

  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if ((await readSnapshot(session)).imageCount === before + 1) return;
    await sleep(500);
  }
  throw new Error('The X composer did not finish uploading an image.');
}

function normalizedText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trim();
}

async function waitForComposerReady(
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
      && snapshot.postButtonCount === 1
      && snapshot.postButtonEnabled
    ) {
      return;
    }
    await sleep(500);
  }
  throw new Error('The X composer did not reach a ready state.');
}

async function closeSession(session: PageSession): Promise<void> {
  try {
    await session.cdp.send('Browser.close', {}, { timeoutMs: 5_000 });
  } catch {
    // The browser may already be closed by the user.
  }
  session.cdp.close();
  if (!session.chrome.killed) {
    try { session.chrome.kill('SIGTERM'); } catch {}
  }
}

async function launchComposer(): Promise<PageSession> {
  const chromePath = findChromeExecutable(CHROME_CANDIDATES_FULL);
  if (!chromePath) throw new Error('Chrome not found. Set X_BROWSER_CHROME_PATH.');
  const profileDir = getDefaultProfileDir();
  await mkdir(profileDir, { recursive: true });
  const port = await getFreePort();
  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--start-maximized',
    X_COMPOSE_URL,
  ], { stdio: 'ignore' });

  try {
    const wsUrl = await waitForChromeDebugPort(port, 30_000, { includeLastError: true });
    const cdp = await CdpConnection.connect(wsUrl, 30_000, { defaultTimeoutMs: 15_000 });
    const targets = await cdp.send<{
      targetInfos: Array<{ targetId: string; url: string; type: string }>;
    }>('Target.getTargets');
    let target = targets.targetInfos.find((candidate) => (
      candidate.type === 'page'
      && (candidate.url === X_COMPOSE_URL || candidate.url.startsWith(`${X_COMPOSE_URL}?`))
    ));
    if (!target) {
      const created = await cdp.send<{ targetId: string }>('Target.createTarget', {
        url: X_COMPOSE_URL,
      });
      target = { targetId: created.targetId, url: X_COMPOSE_URL, type: 'page' };
    }
    const attached = await cdp.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    const session: PageSession = {
      cdp,
      sessionId: attached.sessionId,
      targetId: target.targetId,
      chrome,
    };
    await cdp.send('Target.activateTarget', { targetId: target.targetId });
    await cdp.send('Page.enable', {}, { sessionId: session.sessionId });
    await cdp.send('Runtime.enable', {}, { sessionId: session.sessionId });
    await cdp.send('Input.setIgnoreInputEvents', { ignore: false }, { sessionId: session.sessionId });
    return session;
  } catch (error) {
    if (!chrome.killed) {
      try { chrome.kill('SIGTERM'); } catch {}
    }
    throw error;
  }
}

function browserDraft(id: string, session: PageSession): XComposerDraft {
  let closed = false;
  return {
    id,
    snapshot: () => readSnapshot(session),
    clickPost: () => evaluate<boolean>(session, `(() => {
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const editors = Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"]')).filter(visible);
      if (editors.length !== 1) return false;
      const editor = editors[0];
      const root = editor?.closest('[role="dialog"]') || editor?.closest('form') || editor?.parentElement;
      if (!root) return false;
      const buttons = Array.from(root.querySelectorAll(
        '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'
      )).filter((button) => visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
      if (buttons.length !== 1) return false;
      buttons[0].click();
      return true;
    })()`),
    waitForPublishedUrl: async () => {
      const started = Date.now();
      while (Date.now() - started < PUBLISH_EVIDENCE_TIMEOUT_MS) {
        const serialized = await evaluate<string>(session, `(() => {
          const canonical = (value) => {
            try {
              const url = new URL(value, window.location.href);
              const parts = url.pathname.split('/');
              return url.protocol === 'https:'
                && url.hostname === 'x.com'
                && !url.port
                && !url.username
                && !url.password
                && !url.search
                && !url.hash
                && parts.length === 4
                && /^[A-Za-z0-9_]{1,15}$/.test(parts[1] || '')
                && parts[2] === 'status'
                && /^[0-9]+$/.test(parts[3] || '')
                ? url.toString()
                : null;
            } catch { return null; }
          };
          const current = canonical(window.location.href);
          if (current) return JSON.stringify([current]);
          const roots = Array.from(document.querySelectorAll(
            '[role="status"], [data-testid="toast"], [data-testid*="toast" i]'
          ));
          const candidates = Array.from(new Set(roots.flatMap((root) =>
            Array.from(root.querySelectorAll('a[href]'))
              .map((link) => canonical(link.href))
              .filter(Boolean)
          )));
          return JSON.stringify(candidates);
        })()`);
        const candidates = JSON.parse(serialized) as string[];
        if (candidates.length === 1) return candidates[0];
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

export function createLiveXComposerDriver(): XComposerDriver {
  return {
    async prepare(bundlePath: string): Promise<PreparedXComposerDraft> {
      const extracted = await extractXPublicationBundle(bundlePath);
      let session: PageSession | null = null;
      try {
        session = await launchComposer();
        await waitForEditor(session);
        await replaceComposerText(session, extracted.text);
        if ((await readSnapshot(session)).imageCount !== 0) {
          throw new Error('The X composer contains media from an earlier draft.');
        }
        for (const imagePath of extracted.imagePaths) await uploadImage(session, imagePath);
        await waitForComposerReady(session, {
          text: extracted.text,
          imageCount: extracted.imagePaths.length,
        });
        const draft = browserDraft(crypto.randomUUID(), session);
        session = null;
        return {
          draft,
          expectedText: extracted.text,
          expectedImageCount: extracted.imagePaths.length,
        };
      } finally {
        await rm(extracted.bundleDir, { recursive: true, force: true }).catch(() => undefined);
        if (session) await closeSession(session).catch(() => undefined);
      }
    },
  };
}
