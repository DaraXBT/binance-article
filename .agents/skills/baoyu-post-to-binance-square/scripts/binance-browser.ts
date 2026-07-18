import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import process from 'node:process';
import {
  BS_BASE_URL,
  BS_SELECTORS,
  CdpConnection,
  copyImageToClipboard,
  dismissCookieConsent,
  findExistingChromeDebugPort,
  getDefaultProfileDir,
  gracefulKillChrome,
  launchChrome,
  openPageSession,
  pasteFromClipboard,
  sleep,
  waitForAnySelector,
  waitForBinanceSessionPersistence,
  waitForChromeDebugPort,
} from './binance-utils.js';
import { evaluatePublishEvidence } from './publish-safety.js';

interface BinanceBrowserOptions {
  text?: string;
  images?: string[];
  tags?: string[];
  submit?: boolean;
  timeoutMs?: number;
  profileDir?: string;
  chromePath?: string;
}

export async function postToBinanceSquare(options: BinanceBrowserOptions): Promise<void> {
  const { images = [], tags = [], submit = false, timeoutMs = 120_000, profileDir = getDefaultProfileDir() } = options;
  const tagSuffix = tags.length > 0 ? '\n\n' + tags.map(t => `#${t.replace(/^#/, '')}`).join(' ') : '';
  const text = options.text !== undefined ? options.text + tagSuffix : (tagSuffix.trim() || undefined);

  await mkdir(profileDir, { recursive: true });

  const existingPort = await findExistingChromeDebugPort(profileDir);
  const reusing = existingPort !== null;
  let port = existingPort ?? 0;
  let chrome: Awaited<ReturnType<typeof launchChrome>>['chrome'] | null = null;

  if (!reusing) {
    const launched = await launchChrome(BS_BASE_URL, profileDir, options.chromePath);
    port = launched.port;
    chrome = launched.chrome;
  }

  if (reusing) console.log(`[binance-browser] Reusing existing Chrome on port ${port}`);
  else console.log(`[binance-browser] Launching Chrome (profile: ${profileDir})`);

  let cdp: CdpConnection | null = null;
  let sessionId: string | null = null;
  let loggedInDuringRun = false;

  try {
    const wsUrl = await waitForChromeDebugPort(port, 30_000, { includeLastError: true });
    cdp = await CdpConnection.connect(wsUrl, 30_000, { defaultTimeoutMs: 15_000 });

    const page = await openPageSession({
      cdp,
      reusing,
      url: BS_BASE_URL,
      matchTarget: (target) => target.type === 'page' && target.url.includes('binance.com'),
      enablePage: true,
      enableRuntime: true,
      enableNetwork: true,
    });
    sessionId = page.sessionId;
    await cdp.send('Input.setIgnoreInputEvents', { ignore: false }, { sessionId });

    console.log('[binance-browser] Waiting for Binance Square compose area...');
    await sleep(3000);

    if (await dismissCookieConsent(cdp, sessionId)) {
      console.log('[binance-browser] Cookie consent banner accepted');
    }

    let editorSel = await waitForAnySelector(cdp, sessionId, BS_SELECTORS.composeTextarea, 15_000);
    if (!editorSel) {
      if (await dismissCookieConsent(cdp, sessionId)) {
        console.log('[binance-browser] Cookie consent banner accepted, retrying...');
        editorSel = await waitForAnySelector(cdp, sessionId, BS_SELECTORS.composeTextarea, 10_000);
      }
    }
    if (!editorSel) {
      console.log('[binance-browser] Compose area not found. Please log in to Binance Square in the opened Chrome window.');
      console.log('[binance-browser] Waiting up to 120s for login...');
      editorSel = await waitForAnySelector(cdp, sessionId, BS_SELECTORS.composeTextarea, 120_000);
      if (!editorSel) throw new Error('Timed out waiting for Binance Square compose area. Please log in first.');
      loggedInDuringRun = true;
    }

    const activeEditorSel = editorSel;
    console.log(`[binance-browser] Found compose area: ${activeEditorSel}`);

    if (text) {
      console.log('[binance-browser] Typing text...');
      await cdp.send('Runtime.evaluate', {
        expression: `
          const editor = document.querySelector(${JSON.stringify(activeEditorSel)});
          if (editor) {
            editor.focus();
            document.execCommand('insertText', false, ${JSON.stringify(text)});
          }
        `,
      }, { sessionId });
      await sleep(500);
    }

    for (const imagePath of images) {
      if (!fs.existsSync(imagePath)) {
        console.warn(`[binance-browser] Image not found: ${imagePath}`);
        continue;
      }

      console.log(`[binance-browser] Pasting image: ${imagePath}`);

      if (!copyImageToClipboard(imagePath)) {
        console.warn(`[binance-browser] Failed to copy image to clipboard: ${imagePath}`);
        continue;
      }

      const imgCountBefore = await cdp.send<{ result: { value: number } }>('Runtime.evaluate', {
        expression: `document.querySelectorAll('img[src^="blob:"]').length`,
        returnByValue: true,
      }, { sessionId });

      await sleep(500);

      await cdp.send('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(activeEditorSel)})?.focus()`,
      }, { sessionId });
      await sleep(200);

      console.log('[binance-browser] Pasting from clipboard...');
      const pasteSuccess = pasteFromClipboard('Google Chrome', 5, 500);

      if (!pasteSuccess) {
        console.log('[binance-browser] Paste script failed, trying CDP fallback...');
        const modifiers = process.platform === 'darwin' ? 4 : 2;
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyDown', key: 'v', code: 'KeyV', modifiers, windowsVirtualKeyCode: 86,
        }, { sessionId });
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'v', code: 'KeyV', modifiers, windowsVirtualKeyCode: 86,
        }, { sessionId });
      }

      console.log('[binance-browser] Verifying image upload...');
      const expectedImgCount = imgCountBefore.result.value + 1;
      let imgUploadOk = false;
      const imgWaitStart = Date.now();
      while (Date.now() - imgWaitStart < 15_000) {
        const r = await cdp!.send<{ result: { value: number } }>('Runtime.evaluate', {
          expression: `document.querySelectorAll('img[src^="blob:"]').length`,
          returnByValue: true,
        }, { sessionId });
        if (r.result.value >= expectedImgCount) { imgUploadOk = true; break; }
        await sleep(1000);
      }

      if (imgUploadOk) {
        console.log('[binance-browser] Image upload verified');
      } else {
        console.warn('[binance-browser] Image upload not detected after 15s. Check clipboard permissions.');
      }
    }

    if (submit) {
      console.log('[binance-browser] Submitting post...');
      const beforeUrlResult = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true,
      }, { sessionId });
      const beforeUrl = beforeUrlResult.result.value;
      const submitSel = await waitForAnySelector(cdp, sessionId, BS_SELECTORS.publishButton, 10_000);
      let submitted = false;
      if (submitSel) {
        await cdp.send('Runtime.evaluate', {
          expression: `document.querySelector(${JSON.stringify(submitSel)})?.click()`,
        }, { sessionId });
        submitted = true;
      } else {
        const byText = await cdp.send<{ result: { value: boolean } }>('Runtime.evaluate', {
          expression: `(() => {
            const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
            const roots = Array.from(document.querySelectorAll('[data-testid*="compose" i], [role="dialog"], .bn-modal'));
            for (const root of roots) {
              const btn = Array.from(root.querySelectorAll('button'))
                .filter(isVisible)
                .find(b => /^(publish|post|发布)$/i.test((b.textContent || '').trim()) && !b.disabled);
              if (btn) { btn.click(); return true; }
            }
            return false;
          })()`,
          returnByValue: true,
        }, { sessionId });
        submitted = byText.result.value;
      }
      if (submitted) {
        const started = Date.now();
        let verified = false;
        let reason = '';
        while (Date.now() - started < 15_000) {
          await sleep(750);
          const afterResult = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
            expression: `(() => JSON.stringify({
              url: window.location.href,
              successToast: /(published successfully|post published|发布成功|已发布)/i.test(document.body?.innerText || ''),
              editorVisible: Boolean(document.querySelector(${JSON.stringify(activeEditorSel)})),
            }))()`,
            returnByValue: true,
          }, { sessionId });
          const after = JSON.parse(afterResult.result.value) as { url: string; successToast: boolean; editorVisible: boolean };
          const evidence = evaluatePublishEvidence({ beforeUrl, afterUrl: after.url, successToast: after.successToast, editorVisible: after.editorVisible });
          if (evidence.verified) { verified = true; reason = evidence.reason; break; }
        }
        if (!verified) throw new Error('Post was clicked, but Binance did not expose a verifiable success state.');
        console.log(`[binance-browser] Verified post: ${reason}`);
      } else {
        console.warn('[binance-browser] Publish button not found. Please submit manually.');
      }
    } else {
      console.log('[binance-browser] Post composed. Please review and click the publish button in the browser.');
    }
  } finally {
    let leaveChromeOpen = !submit;
    if (chrome && submit && loggedInDuringRun && cdp && sessionId) {
      console.log('[binance-browser] Waiting for Binance session cookies to persist...');
      const sessionReady = await waitForBinanceSessionPersistence({ cdp, sessionId });
      if (!sessionReady) {
        console.warn('[binance-browser] Session cookies not observed yet. Leaving Chrome open so login can finish persisting.');
        leaveChromeOpen = true;
      }
    }

    if (cdp) cdp.close();
    if (chrome) {
      if (leaveChromeOpen) {
        chrome.unref();
      } else {
        await gracefulKillChrome(chrome, port);
      }
    }
  }
}

function printUsage(): never {
  console.log(`Post to Binance Square using real Chrome browser

Usage:
  npx -y bun binance-browser.ts [options] [text]

Options:
  --image <path>        Add image (can be repeated)
  --tag <hashtag>       Append hashtag (can be repeated, # optional)
  --submit              Actually post (default: preview only)
  --profile <dir>       Chrome profile directory
  --chrome-path <path>  Override Chrome executable path
  --help                Show this help

Examples:
  npx -y bun binance-browser.ts "Hello from CLI!"
  npx -y bun binance-browser.ts "Check this out" --image ./screenshot.png
  npx -y bun binance-browser.ts "Post it!" --image a.png --image b.png --submit
`);
  process.exit(0);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) printUsage();

  const images: string[] = [];
  const tags: string[] = [];
  let submit = false;
  let profileDir: string | undefined;
  const textParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--image' && args[i + 1]) {
      images.push(args[++i]!);
    } else if (arg === '--tag' && args[i + 1]) {
      tags.push(args[++i]!);
    } else if (arg === '--submit') {
      submit = true;
    } else if (arg === '--profile' && args[i + 1]) {
      profileDir = args[++i];
    } else if (!arg.startsWith('-')) {
      textParts.push(arg);
    }
  }

  const text = textParts.join(' ').trim() || undefined;

  if (!text && images.length === 0 && tags.length === 0) {
    console.error('Error: Provide text, at least one image, or at least one tag.');
    process.exit(1);
  }

  await postToBinanceSquare({ text, images, tags, submit, profileDir });
}

if (import.meta.main) {
  await main().catch((err) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
