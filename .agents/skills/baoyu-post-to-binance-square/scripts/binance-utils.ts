import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  CdpConnection,
  findChromeExecutable as findChromeExecutableBase,
  findExistingChromeDebugPort as findExistingChromeDebugPortBase,
  getFreePort as getFreePortBase,
  gracefulKillChrome,
  killChrome,
  launchChrome as launchChromeBase,
  openPageSession,
  resolveSharedChromeProfileDir,
  sleep,
  waitForChromeDebugPort,
  type PlatformCandidates,
} from 'baoyu-chrome-cdp';

export { CdpConnection, gracefulKillChrome, killChrome, openPageSession, sleep, waitForChromeDebugPort };
export type { PlatformCandidates } from 'baoyu-chrome-cdp';

export const BS_BASE_URL = 'https://www.binance.com/en/square';
export const BS_CREATOR_CENTER_URL = 'https://www.binance.com/en/square/creator-center/home';

export const BS_SELECTORS = {
  composeTextarea: [
    'textarea[data-testid="compose-textarea"]',
    'div[data-testid="compose-input"][contenteditable="true"]',
    'div[contenteditable="true"][data-placeholder]',
    'div[role="textbox"][contenteditable="true"]',
    'textarea[placeholder]',
    'div[contenteditable="true"]',
  ],
  publishButton: [
    'button[data-testid="square-publish-btn"]',
    'button[data-testid="square-post-btn"]',
    '[role="dialog"] button[data-testid="publish-btn"]',
    '[data-testid*="compose" i] button[data-testid="post-btn"]',
    'button[aria-label="Publish"]',
    'button[aria-label="Post"]',
    '[data-role="square-publish"]',
  ],
  articleTitleInput: [
    '.article-editor textarea',
    '.css-1cxhrek textarea',
    'textarea.css-1eno7b4',
    'textarea[placeholder*="title" i]',
    'input[placeholder*="title" i]',
    'textarea[placeholder*="标题"]',
    'input[placeholder*="标题"]',
    'div[contenteditable="true"][data-placeholder*="title" i]',
    'h1[contenteditable="true"]',
    '[data-testid*="title"]',
    'input[name="title"]',
  ],
  createContentButton: [
    'button.bn-button__primary',
    'button[class*="bn-button"][class*="primary"]',
    '[data-testid="create-content-btn"]',
    'button[class*="create-content"]',
  ],
  articleModeButton: [
    'div.article-icon',
    '[class*="article-icon"]',
  ],
  articleEditor: [
    '.json-article-editor div.ProseMirror[contenteditable="true"]',
    '.article-editor div.ProseMirror[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"].ql-editor',
    'div[contenteditable="true"][data-placeholder*="content" i]',
    'div[contenteditable="true"][data-placeholder*="text" i]',
    'div[contenteditable="true"][data-placeholder*="write" i]',
    'div[contenteditable="true"]',
  ],
  articlePublishButton: [
    'button[data-testid="article-publish-btn"]',
    '[data-testid="article-editor-publish"] button',
    '.editor-container button[data-testid="publish-btn"]',
    '.article-editor button[data-testid="publish-btn"]',
    '.editor-container button[data-testid="submit-btn"]',
    'button[aria-label="Publish article"]',
    'button[aria-label="发布文章"]',
    '[data-role="article-publish"]',
  ],
  coverUploadButton: [
    'span.rc-upload button',
    '.editor-container span.rc-upload button',
    '.editor-container button[type="button"]',
  ],
  coverFileInput: [
    'span.rc-upload input[type="file"][accept*=".jpg"]',
    'span.rc-upload input[type="file"]',
    '.editor-container input[type="file"][accept*=".jpg"]',
  ],
  cookieConsentButton: [
    '#onetrust-accept-btn-handler',
    'button[id*="accept-btn"]',
    '[data-testid="cookie-accept"]',
    'div[class*="cookie"] button[class*="primary"]',
  ],
};

const COOKIE_CONSENT_TEXTS = [
  'accept all cookies',
  'accept all',
  'accept cookies',
  '接受所有 cookie',
  '接受所有',
  '全部接受',
  '接受全部',
];

export async function dismissCookieConsent(cdp: CdpConnection, sessionId: string): Promise<boolean> {
  const result = await cdp.send<{ result: { value: boolean } }>('Runtime.evaluate', {
    expression: `(() => {
      const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const selectors = ${JSON.stringify(BS_SELECTORS.cookieConsentButton)};
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && isVisible(el)) { el.click(); return true; }
      }
      const texts = ${JSON.stringify(COOKIE_CONSENT_TEXTS)};
      const btns = Array.from(document.querySelectorAll('button')).filter(isVisible);
      const btn = btns.find(b => texts.includes((b.textContent || '').trim().toLowerCase()));
      if (btn) { btn.click(); return true; }
      return false;
    })()`,
    returnByValue: true,
  }, { sessionId }).catch(() => ({ result: { value: false } }));
  if (result.result.value) await sleep(800);
  return result.result.value;
}

export const CHROME_CANDIDATES_FULL: PlatformCandidates = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  default: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
  ],
};

let _wslHome: string | null | undefined;
function getWslWindowsHome(): string | null {
  if (_wslHome !== undefined) return _wslHome;
  if (!process.env.WSL_DISTRO_NAME) { _wslHome = null; return null; }
  try {
    const cmdResult = spawnSync('cmd.exe', ['/C', 'echo %USERPROFILE%'], { encoding: 'utf-8', timeout: 5000 });
    const raw = (cmdResult.stdout ?? '').trim().replace(/\r/g, '');
    if (!raw) { _wslHome = null; return null; }
    const wslResult = spawnSync('wslpath', ['-u', raw], { encoding: 'utf-8', timeout: 5000 });
    _wslHome = wslResult.stdout?.trim() || null;
  } catch { _wslHome = null; }
  return _wslHome;
}

export function getDefaultProfileDir(): string {
  return resolveSharedChromeProfileDir({
    envNames: ['BAOYU_CHROME_PROFILE_DIR'],
    wslWindowsHome: getWslWindowsHome(),
  });
}

export function findChromeExecutable(candidates: PlatformCandidates): string | null {
  return findChromeExecutableBase({ candidates, envNames: ['BS_CHROME_PATH'] }) ?? null;
}

export async function getFreePort(): Promise<number> {
  return await getFreePortBase('BS_BROWSER_DEBUG_PORT');
}

export async function findExistingChromeDebugPort(profileDir: string): Promise<number | null> {
  return await findExistingChromeDebugPortBase({ profileDir });
}

const CHROME_LOCK_FILES = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'chrome.pid'] as const;

export function hasChromeLockArtifacts(entries: readonly string[]): boolean {
  return CHROME_LOCK_FILES.some((name) => entries.includes(name));
}

export function shouldRetryChromeLaunch(options: {
  lockArtifactsPresent: boolean;
  hasLiveOwner: boolean;
}): boolean {
  return options.lockArtifactsPresent && !options.hasLiveOwner;
}

function hasLiveChromeOwner(profileDir: string): boolean {
  if (process.platform === 'win32') return false;
  try {
    const result = spawnSync('ps', ['aux'], { encoding: 'utf8', timeout: 5000 });
    if (result.status !== 0 || !result.stdout) return false;
    return result.stdout.split('\n').some((line) => line.includes(`--user-data-dir=${profileDir}`));
  } catch {
    return false;
  }
}

function cleanStaleLockFiles(profileDir: string): void {
  for (const name of CHROME_LOCK_FILES) {
    try { fs.unlinkSync(path.join(profileDir, name)); } catch {}
  }
}

async function listProfileDirEntries(profileDir: string): Promise<string[]> {
  try {
    return await fs.promises.readdir(profileDir);
  } catch {
    return [];
  }
}

async function launchChromeOnce(
  url: string,
  profileDir: string,
  chromePath: string,
): Promise<{ chrome: Awaited<ReturnType<typeof launchChromeBase>>; port: number }> {
  const port = await getFreePort();
  const chrome = await launchChromeBase({
    chromePath,
    profileDir,
    port,
    url,
    extraArgs: ['--start-maximized'],
  });

  try {
    await waitForChromeDebugPort(port, 30_000, { includeLastError: true });
    chrome.unref();
    return { chrome, port };
  } catch (error) {
    killChrome(chrome);
    throw error;
  }
}

export async function launchChrome(
  url: string,
  profileDir: string,
  chromePathOverride?: string,
): Promise<{ chrome: Awaited<ReturnType<typeof launchChromeBase>>; port: number }> {
  const chromePath = chromePathOverride?.trim() || findChromeExecutableBase({
    candidates: CHROME_CANDIDATES_FULL,
    envNames: ['BS_CHROME_PATH'],
  });
  if (!chromePath) throw new Error('Chrome not found. Set BS_CHROME_PATH env var or install Google Chrome.');

  try {
    return await launchChromeOnce(url, profileDir, chromePath);
  } catch (error) {
    const entries = await listProfileDirEntries(profileDir);
    const shouldRetry = shouldRetryChromeLaunch({
      lockArtifactsPresent: hasChromeLockArtifacts(entries),
      hasLiveOwner: hasLiveChromeOwner(profileDir),
    });
    if (!shouldRetry) throw error;
    cleanStaleLockFiles(profileDir);
    return await launchChromeOnce(url, profileDir, chromePath);
  }
}

export function getScriptDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function runBunScript(scriptPath: string, args: string[]): boolean {
  const result = spawnSync('npx', ['-y', 'bun', scriptPath, ...args], { stdio: 'inherit' });
  return result.status === 0;
}

export function uploadFileViaOSDialog(filePath: string): boolean {
  if (process.platform !== 'darwin') return false;
  // Use Cmd+Shift+G in the native file open dialog to type path directly
  const script = `
    tell application "System Events"
      delay 0.5
      keystroke "g" using {command down, shift down}
      delay 0.5
      keystroke ${JSON.stringify(filePath)}
      delay 0.3
      key code 36
      delay 0.5
      key code 36
    end tell
  `;
  const result = spawnSync('osascript', ['-e', script], { stdio: 'pipe' });
  return result.status === 0;
}

export function copyImageToClipboard(imagePath: string): boolean {
  const copyScript = path.join(getScriptDir(), 'copy-to-clipboard.ts');
  return runBunScript(copyScript, ['image', imagePath]);
}

export function copyHtmlToClipboard(htmlPath: string): boolean {
  const copyScript = path.join(getScriptDir(), 'copy-to-clipboard.ts');
  return runBunScript(copyScript, ['html', '--file', htmlPath]);
}

export function pasteFromClipboard(targetApp?: string, retries = 3, delayMs = 500): boolean {
  const pasteScript = path.join(getScriptDir(), 'paste-from-clipboard.ts');
  const args = ['--retries', String(retries), '--delay', String(delayMs)];
  if (targetApp) args.push('--app', targetApp);
  return runBunScript(pasteScript, args);
}

export async function resolveSelector(
  cdp: CdpConnection,
  sessionId: string,
  selectors: readonly string[],
): Promise<string | null> {
  for (const sel of selectors) {
    const result = await cdp.send<{ result: { value: boolean } }>('Runtime.evaluate', {
      expression: `!!document.querySelector(${JSON.stringify(sel)})`,
      returnByValue: true,
    }, { sessionId });
    if (result.result.value) return sel;
  }
  return null;
}

export async function waitForAnySelector(
  cdp: CdpConnection,
  sessionId: string,
  selectors: readonly string[],
  timeoutMs = 60_000,
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await resolveSelector(cdp, sessionId, selectors);
    if (found) return found;
    await sleep(1000);
  }
  return null;
}

const BS_SESSION_URLS = ['https://www.binance.com/'] as const;
const REQUIRED_BS_SESSION_COOKIES = ['com.binance.certification', 'csrftoken'] as const;

interface CookieLike {
  name?: string;
  value?: string | null;
}

interface NetworkGetCookiesResult {
  cookies?: CookieLike[];
}

export function buildBinanceSessionCookieMap(cookies: readonly CookieLike[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const cookie of cookies) {
    const name = cookie.name?.trim();
    const value = cookie.value?.trim();
    if (name && value) map[name] = value;
  }
  return map;
}

export function hasRequiredBinanceSessionCookies(cookieMap: Record<string, string>): boolean {
  return REQUIRED_BS_SESSION_COOKIES.some((name) => Boolean(cookieMap[name]));
}

export async function waitForBinanceSessionPersistence(options: {
  cdp: CdpConnection;
  sessionId?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { cookies } = await options.cdp.send<NetworkGetCookiesResult>(
      'Network.getCookies',
      { urls: [...BS_SESSION_URLS] },
      { sessionId: options.sessionId, timeoutMs: 5_000 },
    ).catch(() => ({ cookies: [] as CookieLike[] }));
    if (hasRequiredBinanceSessionCookies(buildBinanceSessionCookieMap(cookies ?? []))) return true;
    await sleep(pollIntervalMs);
  }
  return false;
}
