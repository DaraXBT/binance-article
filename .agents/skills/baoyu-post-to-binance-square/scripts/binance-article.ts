import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseMarkdown } from './md-to-html.js';
import {
  BS_CREATOR_CENTER_URL,
  BS_SELECTORS,
  CdpConnection,
  copyHtmlToClipboard,
  dismissCookieConsent,
  findExistingChromeDebugPort,
  getDefaultProfileDir,
  gracefulKillChrome,
  launchChrome,
  openPageSession,
  pasteFromClipboard,
  resolveSelector,
  sleep,
  uploadFileViaOSDialog,
  waitForAnySelector,
  waitForChromeDebugPort,
} from './binance-utils.js';

interface ArticleOptions {
  markdownPath: string;
  coverImage?: string;
  title?: string;
  submit?: boolean;
  profileDir?: string;
  chromePath?: string;
  hashtags?: boolean;
  coinTags?: boolean;
}

interface CodeBlockInfo {
  placeholder: string;
  language: string;
  content: string;
}

type Block = { type: string; text?: string; items?: string[] };

const IMG_MIME: Record<string, string> = { '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };

// Decodes entities so prefixes derived from rendered HTML match the live
// editor's textContent (the browser decodes &#x...; refs that md-to-html keeps
// for CJK-adjacent emphasis).
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, '')).trim();
}

function parseBlockStructure(html: string): Block[] {
  const blocks: Block[] = [];
  const blockRe = /<(h[1-6]|p|ul|ol|blockquote|hr)(?:[^>]*)>([\s\S]*?)<\/\1>|<hr[^>]*\/?>/gi;
  for (const m of html.matchAll(blockRe)) {
    const tag = (m[1] ?? 'hr').toLowerCase();
    const inner = m[2] ?? '';
    if (tag === 'ul' || tag === 'ol') {
      const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
        .map(li => htmlToText(li[1]));
      blocks.push({ type: tag, items });
    } else {
      blocks.push({ type: tag, text: htmlToText(inner) });
    }
  }
  return blocks;
}

// Builds a JS IIFE that walks the React fiber from .json-article-editor to find the TipTap editor.
// The fiber key lives on the container div, NOT on .ProseMirror (which has no fiber key).
// `command` is the TipTap command capability to require. `body` is injected after editor is found
// and must end with `return JSON.stringify({ok:true, ...})`.
function fiberWalkJS(command: string, body: string): string {
  return `(() => {
    const container = document.querySelector('.json-article-editor');
    if (!container) return JSON.stringify({ok:false,error:'no-container'});
    const fiberKey = Object.keys(container).find(k =>
      k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    if (!fiberKey) return JSON.stringify({ok:false,error:'no-fiber'});
    let fiber = container[fiberKey];
    let editor = null;
    for (let i = 0; i < 100 && fiber; i++) {
      const ed = (fiber.memoizedProps ?? fiber.pendingProps)?.editor;
      if (ed?.commands?.${command} && ed?.view) { editor = ed; break; }
      fiber = fiber.return;
    }
    if (!editor) return JSON.stringify({ok:false,error:'no-editor'});
    ${body}
  })()`;
}

async function clickParagraphByPrefix(
  cdp: CdpConnection,
  sessionId: string,
  editorSel: string,
  prefix: string,
): Promise<boolean> {
  const res = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
    expression: `(() => {
      const editorEl = document.querySelector(${JSON.stringify(editorSel)});
      if (!editorEl) return JSON.stringify({status:'no-editor'});
      const blocks = Array.from(editorEl.querySelectorAll('p'));
      const target = blocks.find(b => b.textContent.trim().startsWith(${JSON.stringify(prefix)}));
      if (!target) return JSON.stringify({status:'not-found'});
      target.scrollIntoView({ behavior: 'instant', block: 'center' });
      const rect = target.getBoundingClientRect();
      return JSON.stringify({ status:'found', x: Math.round(rect.left + 4), y: Math.round(rect.top + Math.floor(rect.height / 2)) });
    })()`,
    returnByValue: true,
  }, { sessionId });
  const coords = JSON.parse(res.result.value) as { status: string; x?: number; y?: number };
  if (coords.status !== 'found' || coords.x === undefined || coords.y === undefined) return false;
  await sleep(150);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: coords.x, y: coords.y, button: 'left', clickCount: 1, modifiers: 0 }, { sessionId });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coords.x, y: coords.y, button: 'left', clickCount: 1, modifiers: 0 }, { sessionId });
  await sleep(150);
  return true;
}

async function applyListViaKeyboard(
  cdp: CdpConnection,
  sessionId: string,
  editorSel: string,
  items: string[],
): Promise<void> {
  for (const itemText of items) {
    const prefix = itemText.slice(0, 40);
    const clicked = await clickParagraphByPrefix(cdp, sessionId, editorSel, prefix);
    if (!clicked) {
      console.warn(`[binance-article] List item not found for keyboard fallback: "${prefix}"`);
      continue;
    }
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '8', code: 'Digit8', keyCode: 56, modifiers: 12 }, { sessionId });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '8', code: 'Digit8', keyCode: 56, modifiers: 12 }, { sessionId });
    await sleep(300);
  }
}

async function applyBlockquoteViaKeyboard(
  cdp: CdpConnection,
  sessionId: string,
  editorSel: string,
  prefix: string,
): Promise<void> {
  const clicked = await clickParagraphByPrefix(cdp, sessionId, editorSel, prefix.slice(0, 40));
  if (!clicked) {
    console.warn(`[binance-article] Blockquote not found for keyboard fallback: "${prefix}"`);
    return;
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'b', code: 'KeyB', keyCode: 66, modifiers: 12 }, { sessionId });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'b', code: 'KeyB', keyCode: 66, modifiers: 12 }, { sessionId });
  await sleep(300);
}

async function applyStructuralFormatting(
  cdp: CdpConnection,
  sessionId: string,
  editorSel: string,
  blocks: Block[],
): Promise<void> {
  const expectedLists = blocks.filter(b => b.type === 'ul' || b.type === 'ol');
  const expectedBlockquotes = blocks.filter(b => b.type === 'blockquote');

  if (expectedLists.length === 0 && expectedBlockquotes.length === 0) {
    console.log('[binance-article] No lists or blockquotes in article — skipping structural formatting.');
    return;
  }

  const countRes = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
    expression: `JSON.stringify({
      li: document.querySelector(${JSON.stringify(editorSel)})?.querySelectorAll('li').length || 0,
      bq: document.querySelector(${JSON.stringify(editorSel)})?.querySelectorAll('blockquote').length || 0,
    })`,
    returnByValue: true,
  }, { sessionId });
  const counts = JSON.parse(countRes.result.value) as { li: number; bq: number };
  const expectedLiCount = expectedLists.reduce((n, b) => n + (b.items?.length ?? 0), 0);

  const needsLists = counts.li < expectedLiCount;
  const needsBlockquotes = counts.bq < expectedBlockquotes.length;

  if (!needsLists && !needsBlockquotes) {
    console.log(`[binance-article] Structural formatting already correct (${counts.li} li, ${counts.bq} bq).`);
    return;
  }

  console.log(`[binance-article] Applying structural formatting — need ${expectedLiCount} li, ${expectedBlockquotes.length} bq; have ${counts.li} li, ${counts.bq} bq...`);

  if (needsLists) {
    for (const listBlock of expectedLists) {
      if (!listBlock.items || listBlock.items.length === 0) continue;
      const firstPrefix = listBlock.items[0].slice(0, 40);
      const lastPrefix = listBlock.items[listBlock.items.length - 1].slice(0, 40);

      const res = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
        expression: fiberWalkJS('toggleBulletList', `
          const doc = editor.view.state.doc;
          let startPos = null, endPos = null;
          const first = ${JSON.stringify(firstPrefix)};
          const last = ${JSON.stringify(lastPrefix)};
          doc.descendants((node, pos) => {
            if (!node.isBlock || !node.textContent) return;
            const t = node.textContent.trim();
            if (startPos === null && t.startsWith(first)) startPos = pos + 1;
            if (t.startsWith(last)) endPos = pos + node.nodeSize - 1;
          });
          if (startPos === null || endPos === null) return JSON.stringify({ok:false,error:'not-found'});
          editor.chain().focus().setTextSelection({ from: startPos, to: endPos }).toggleBulletList().run();
          return JSON.stringify({ok:true});
        `),
        returnByValue: true,
      }, { sessionId });

      let outcome: { ok: boolean; error?: string } = { ok: false, error: 'parse-failed' };
      try { outcome = JSON.parse(res.result.value); } catch {}
      if (outcome.ok) {
        console.log(`[binance-article] Bullet list applied via TipTap commands (${listBlock.items.length} items)`);
        await sleep(500);
      } else {
        console.log(`[binance-article] TipTap fiber unavailable (${outcome.error}) — using keyboard fallback for bullet list`);
        await applyListViaKeyboard(cdp, sessionId, editorSel, listBlock.items);
      }
    }
  }

  if (needsBlockquotes) {
    for (const bqBlock of expectedBlockquotes) {
      if (!bqBlock.text) continue;
      const prefix = bqBlock.text.slice(0, 40);

      const res = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
        expression: fiberWalkJS('toggleBlockquote', `
          const doc = editor.view.state.doc;
          let targetPos = null;
          const pfx = ${JSON.stringify(prefix)};
          doc.descendants((node, pos) => {
            if (!node.isBlock || !node.textContent) return;
            const t = node.textContent.trim();
            if (targetPos === null && t.startsWith(pfx)) targetPos = pos + 1;
          });
          if (targetPos === null) return JSON.stringify({ok:false,error:'not-found'});
          editor.chain().focus().setTextSelection({ from: targetPos, to: targetPos }).toggleBlockquote().run();
          return JSON.stringify({ok:true});
        `),
        returnByValue: true,
      }, { sessionId });

      let outcome: { ok: boolean; error?: string } = { ok: false, error: 'parse-failed' };
      try { outcome = JSON.parse(res.result.value); } catch {}
      if (outcome.ok) {
        console.log('[binance-article] Blockquote applied via TipTap commands');
        await sleep(500);
      } else {
        console.log(`[binance-article] TipTap fiber unavailable (${outcome.error}) — using keyboard fallback for blockquote`);
        await applyBlockquoteViaKeyboard(cdp, sessionId, editorSel, prefix);
      }
    }
  }

  const finalRes = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
    expression: `JSON.stringify({
      h2: document.querySelector(${JSON.stringify(editorSel)})?.querySelectorAll('h2').length || 0,
      h3: document.querySelector(${JSON.stringify(editorSel)})?.querySelectorAll('h3').length || 0,
      li: document.querySelector(${JSON.stringify(editorSel)})?.querySelectorAll('li').length || 0,
      bq: document.querySelector(${JSON.stringify(editorSel)})?.querySelectorAll('blockquote').length || 0,
    })`,
    returnByValue: true,
  }, { sessionId });
  const final = JSON.parse(finalRes.result.value) as { h2: number; h3: number; li: number; bq: number };
  console.log(`[binance-article] Structure: ${final.h2} h2 | ${final.h3} h3 | ${final.li} li | ${final.bq} bq`);

  if (expectedLiCount > 0 && final.li === 0) {
    console.warn('[binance-article] WARNING: Expected bullet list items but none found. Check editor formatting.');
  }
}

// Replaces each BSCODEPH_N placeholder paragraph with a native multiCode node.
// HTML cannot express multiCode (its `blocks` attr parses from HTML as a string,
// not an array), so this must go through TipTap insertContentAt with JSON.
async function insertCodeBlocks(
  cdp: CdpConnection,
  sessionId: string,
  editorSel: string,
  codeBlocks: CodeBlockInfo[],
): Promise<void> {
  const getPlaceholderIndex = (placeholder: string): number => {
    const match = placeholder.match(/BSCODEPH_(\d+)/);
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
  };
  const sorted = [...codeBlocks].sort(
    (a, b) => getPlaceholderIndex(a.placeholder) - getPlaceholderIndex(b.placeholder),
  );

  for (let i = 0; i < sorted.length; i++) {
    const block = sorted[i]!;
    console.log(`[binance-article] [${i + 1}/${sorted.length}] Inserting code block at ${block.placeholder} (${block.language})`);

    const nodeJson = {
      type: 'multiCode',
      attrs: { title: '', blocks: [{ language: block.language, content: block.content }] },
    };
    // TipTap chains dispatch their shared transaction even when a command
    // reports failure, so trust the multiCode node-count delta over run()'s
    // return value — otherwise a rejected insertContentAt silently eats the
    // placeholder deletion and the code block is lost.
    const res = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
      expression: fiberWalkJS('insertContentAt', `
        const countMulti = (doc) => { let c = 0; doc.descendants((n) => { if (n.type.name === 'multiCode') c++; }); return c; };
        const doc = editor.view.state.doc;
        const ph = ${JSON.stringify(block.placeholder)};
        let found = null;
        doc.descendants((node, pos) => {
          if (found) return false;
          if (node.isTextblock && node.textContent.trim() === ph) { found = { pos, size: node.nodeSize }; return false; }
        });
        if (!found) return JSON.stringify({ok:false,error:'placeholder-not-found'});
        const before = countMulti(doc);
        const ran = editor.chain().focus()
          .deleteRange({ from: found.pos, to: found.pos + found.size })
          .insertContentAt(found.pos, ${JSON.stringify(nodeJson)})
          .run();
        const after = countMulti(editor.view.state.doc);
        if (after > before) return JSON.stringify({ok:true});
        return JSON.stringify({ok:false,error:'insert-not-applied(ran=' + ran + ')'});
      `),
      returnByValue: true,
    }, { sessionId });

    let outcome: { ok: boolean; error?: string } = { ok: false, error: 'parse-failed' };
    try { outcome = JSON.parse(res.result.value); } catch {}
    if (outcome.ok) {
      console.log('[binance-article] Code block inserted via TipTap multiCode node');
      await sleep(400);
      continue;
    }

    console.warn(`[binance-article] multiCode insertion failed (${outcome.error}) — falling back to plain text`);
    const fallbackRes = await cdp.send<{ result: { value: boolean | string } }>('Runtime.evaluate', {
      expression: `(() => {
        const editor = document.querySelector(${JSON.stringify(editorSel)});
        if (!editor) return 'no-editor';
        const ph = ${JSON.stringify(block.placeholder)};
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent || '';
          let searchStart = 0;
          let idx;
          while ((idx = text.indexOf(ph, searchStart)) !== -1) {
            const charAfter = text[idx + ph.length];
            if (charAfter !== undefined && /\\d/.test(charAfter)) { searchStart = idx + ph.length; continue; }
            const range = document.createRange();
            range.setStart(node, idx);
            range.setEnd(node, idx + ph.length);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            editor.focus();
            return document.execCommand('insertText', false, ${JSON.stringify(block.content)});
          }
        }
        return 'placeholder-not-found';
      })()`,
      returnByValue: true,
    }, { sessionId });
    console.warn(`[binance-article] Plain-text fallback result: ${fallbackRes.result.value}`);
    await sleep(400);
  }
}

async function uploadCoverImage(cdp: CdpConnection, sessionId: string, imagePath: string): Promise<void> {
  const btnSel = await waitForAnySelector(cdp, sessionId, BS_SELECTORS.coverUploadButton, 5_000);
  if (!btnSel) { console.warn('[binance-article] Cover upload button not found, skipping'); return; }
  await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(btnSel)})?.click()`,
  }, { sessionId });
  await sleep(800);
  if (!uploadFileViaOSDialog(imagePath)) { console.warn('[binance-article] OS file dialog upload failed, skipping cover'); return; }
  console.log('[binance-article] Cover image file dialog submitted');
  await sleep(1500);
  const applyResult = await cdp.send<{ result: { value: boolean } }>('Runtime.evaluate', {
    expression: `(() => {
      const keywords = ['apply', 'confirm', 'ok', 'done', 'save', 'submit', '确认', '应用', '完成', '提交'];
      function isVisible(el) {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      function matchText(b) {
        const t = b.textContent.trim().toLowerCase();
        return keywords.some(kw => t === kw || t.includes(kw));
      }
      // Prefer buttons inside a modal/dialog/overlay
      const modalBtn = document.querySelector([
        'div[class*="modal"] button[class*="primary"]',
        'div[class*="dialog"] button[class*="primary"]',
        'div[class*="overlay"] button[class*="primary"]',
        'div[class*="popup"] button[class*="primary"]',
        'div[class*="crop"] button[class*="primary"]',
      ].join(','));
      if (modalBtn && isVisible(modalBtn)) { modalBtn.click(); return true; }
      // Fall back to text matching across all visible buttons
      const btns = Array.from(document.querySelectorAll('button')).filter(isVisible);
      const btn = btns.find(matchText);
      if (btn) { btn.click(); return true; }
      return false;
    })()`,
    returnByValue: true,
  }, { sessionId });
  if (applyResult.result.value) {
    console.log('[binance-article] Cover confirm dialog clicked');
  } else {
    console.warn('[binance-article] No cover confirm button found, proceeding');
  }
  await sleep(2500);
}

export async function publishArticle(options: ArticleOptions): Promise<void> {
  const { markdownPath, submit = false, profileDir = getDefaultProfileDir() } = options;

  console.log('[binance-article] Parsing markdown...');
  const parsed = await parseMarkdown(markdownPath, {
    title: options.title,
    coverImage: options.coverImage,
    hashtags: options.hashtags,
    coinTags: options.coinTags,
  });

  console.log(`[binance-article] Title: ${parsed.title}`);
  console.log(`[binance-article] Cover: ${parsed.coverImage ?? 'none'}`);
  console.log(`[binance-article] Content images: ${parsed.contentImages.length}`);
  console.log(`[binance-article] Code blocks: ${parsed.codeBlocks.length}`);

  const blocks = parseBlockStructure(parsed.html);
  const htmlPath = path.join(os.tmpdir(), 'bs-article-content.html');
  await writeFile(htmlPath, parsed.html, 'utf-8');
  console.log(`[binance-article] HTML saved to: ${htmlPath}`);

  await mkdir(profileDir, { recursive: true });
  const existingPort = await findExistingChromeDebugPort(profileDir);
  const reusing = existingPort !== null;
  let port = existingPort ?? 0;

  if (reusing) {
    console.log(`[binance-article] Reusing existing Chrome instance on port ${port}`);
  } else {
    console.log('[binance-article] Launching Chrome...');
    const launched = await launchChrome(BS_CREATOR_CENTER_URL, profileDir, options.chromePath);
    port = launched.port;
  }

  let cdp: CdpConnection | null = null;

  try {
    const wsUrl = await waitForChromeDebugPort(port, 30_000, { includeLastError: true });
    cdp = await CdpConnection.connect(wsUrl, 30_000, { defaultTimeoutMs: 60_000 });

    const page = await openPageSession({
      cdp,
      reusing,
      url: BS_CREATOR_CENTER_URL,
      matchTarget: (target) => target.type === 'page' && target.url.includes('binance.com'),
      enablePage: true,
      enableRuntime: true,
      enableDom: true,
    });
    let sessionId = page.sessionId;

    console.log('[binance-article] Waiting for Creator Center...');
    await sleep(3000);

    if (await dismissCookieConsent(cdp, sessionId)) {
      console.log('[binance-article] Cookie consent banner accepted');
    }

    // Click "Create Content" button
    let createBtnSel = await waitForAnySelector(cdp, sessionId, BS_SELECTORS.createContentButton, 30_000);
    if (!createBtnSel) {
      if (await dismissCookieConsent(cdp, sessionId)) {
        console.log('[binance-article] Cookie consent banner accepted, retrying...');
        createBtnSel = await waitForAnySelector(cdp, sessionId, BS_SELECTORS.createContentButton, 10_000);
      }
    }
    if (!createBtnSel) {
      console.log('[binance-article] Create Content button not found. Please log in to Binance Square in the opened Chrome window.');
      console.log('[binance-article] Waiting up to 120s for login...');
      createBtnSel = await waitForAnySelector(cdp, sessionId, BS_SELECTORS.createContentButton, 120_000);
    }
    if (createBtnSel) {
      console.log('[binance-article] Clicking Create Content...');
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(createBtnSel)});
          if (el) { el.click(); return; }
          const btn = Array.from(document.querySelectorAll('button')).find(b => /create\\s+content|创建内容|发布内容|创作/i.test(b.textContent));
          if (btn) btn.click();
        })()`,
      }, { sessionId });
      await sleep(2000);

      // Recover from "Logged Out" (400) modal that Binance shows on expired sessions
      await sleep(500);
      const loggedOut = await cdp.send<{ result: { value: boolean } }>('Runtime.evaluate', {
        expression: `document.body.innerText.includes('Logged Out') || document.body.innerText.includes('logged out. You must log in') || document.body.innerText.includes('已登出') || document.body.innerText.includes('重新登录')`,
        returnByValue: true,
      }, { sessionId });
      if (loggedOut.result.value) {
        console.log('[binance-article] Detected "Logged Out" modal — clicking Log In...');
        await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const btn = Array.from(document.querySelectorAll('button')).find(b => /^(log\\s*in|登录)$/i.test((b.textContent || '').trim()));
            if (btn) { btn.click(); return true; }
            return false;
          })()`,
        }, { sessionId });
        await sleep(2000);
        console.log('[binance-article] Waiting up to 120s for re-login...');
        const reloginSel = await waitForAnySelector(cdp, sessionId, BS_SELECTORS.createContentButton, 120_000);
        if (reloginSel) {
          console.log('[binance-article] Re-login detected. Re-clicking Create Content...');
          await cdp.send('Runtime.evaluate', {
            expression: `document.querySelector(${JSON.stringify(reloginSel)})?.click()`,
          }, { sessionId });
          await sleep(2000);
        } else {
          console.warn('[binance-article] Re-login timed out — proceeding anyway');
        }
      }

      // Click "Article" mode button in the compose modal
      const articleBtnSel = await waitForAnySelector(cdp, sessionId, BS_SELECTORS.articleModeButton, 10_000);
      if (articleBtnSel) {
        console.log('[binance-article] Switching to Article mode...');
        await cdp.send('Runtime.evaluate', {
          expression: `document.querySelector(${JSON.stringify(articleBtnSel)})?.click()`,
        }, { sessionId });
        await sleep(2000);
      }

      // Click the title area to reveal the hidden textarea
      await cdp.send('Runtime.evaluate', {
        expression: `document.querySelector('.css-1cxhrek, .article-editor')?.click()`,
      }, { sessionId });
      await sleep(500);
    } else {
      console.log('[binance-article] Proceeding without Create Content button — navigate to article editor manually.');
    }

    // Wait for article title input (textarea revealed by clicking title area)
    console.log('[binance-article] Waiting for article editor...');
    const titleSel = await waitForAnySelector(cdp, sessionId, BS_SELECTORS.articleTitleInput, 30_000);
    if (!titleSel) {
      console.log('[binance-article] Article editor not found. Please navigate to the article editor in this Chrome window.');
      console.log('[binance-article] Waiting 60s for manual navigation...');
      await sleep(60_000);

      // Scan all open Binance tabs — the editor may have opened in a new tab
      const targetsRes = await cdp.send<{ targetInfos: Array<{ targetId: string; type: string; url: string }> }>('Target.getTargets', {});
      for (const target of targetsRes.targetInfos) {
        if (target.type !== 'page' || !target.url.includes('binance.com')) continue;
        try {
          const attachRes = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: target.targetId, flatten: true });
          const testSid = attachRes.sessionId;
          const found = await waitForAnySelector(cdp, testSid, BS_SELECTORS.articleTitleInput, 3_000);
          if (found) {
            sessionId = testSid;
            console.log(`[binance-article] Found article editor in tab: ${target.url}`);
            break;
          }
        } catch { /* skip non-attachable targets */ }
      }

      const retried = await waitForAnySelector(cdp, sessionId, BS_SELECTORS.articleTitleInput, 5_000);
      if (!retried) throw new Error('Article editor not found. Please navigate to the article creation page.');
    }

    const activeTitleSel = titleSel ?? (await resolveSelector(cdp, sessionId, BS_SELECTORS.articleTitleInput))!;
    console.log(`[binance-article] Found title input: ${activeTitleSel}`);

    // Fill title
    if (parsed.title) {
      console.log('[binance-article] Filling title...');
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(activeTitleSel)});
          if (el) { el.focus(); return true; }
          return false;
        })()`,
      }, { sessionId });
      await sleep(200);
      await cdp.send('Input.insertText', { text: parsed.title }, { sessionId });
      await sleep(300);

      // Tab out to trigger save
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, { sessionId });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, { sessionId });
      await sleep(500);
    }

    // Try to find the editor BEFORE cover upload — if TipTap is available now, insert content first
    // to avoid any state reset caused by the cover image upload workflow.
    let earlyEditorSel = await waitForAnySelector(cdp, sessionId, BS_SELECTORS.articleEditor, 5_000);

    if (parsed.coverImage) {
      console.log(`[binance-article] Uploading cover image: ${path.basename(parsed.coverImage)}`);
      await uploadCoverImage(cdp, sessionId, parsed.coverImage);
    }

    // Wait for the body editor to appear (may already be found above)
    const editorSel = earlyEditorSel ?? await waitForAnySelector(cdp, sessionId, BS_SELECTORS.articleEditor, 30_000);
    if (!editorSel) throw new Error('Article body editor not found.');
    console.log(`[binance-article] Found article editor: ${editorSel}${earlyEditorSel ? ' (pre-cover)' : ''}`);

    // Insert HTML content (4-method fallback; Method 0 uses React fiber to preserve heading structure)
    console.log('[binance-article] Inserting content...');
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const editor = document.querySelector(${JSON.stringify(editorSel)});
        if (editor) { editor.focus(); editor.click(); return true; }
        return false;
      })()`,
    }, { sessionId });
    await sleep(300);

    let contentInserted = false;

    // Method 0: component tree setContent — bypasses TipTap paste sanitization to preserve <h2> headings.
    // Tries React fiber (getOwnPropertyNames for non-enumerable keys), Vue 3 (__vueParentComponent),
    // and Vue 2 (__vue__) by walking UP the DOM from the ProseMirror div.
    console.log('[binance-article] Attempting content insertion via component tree setContent...');
    const fiberResult = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
      expression: `(() => {
        const editorEl = document.querySelector(${JSON.stringify(editorSel)});
        if (!editorEl) return 'no-element';

        function trySetContent(editor) {
          if (editor && typeof editor.commands?.setContent === 'function') {
            editor.commands.setContent(${JSON.stringify(htmlContent)}, true);
            return true;
          }
          return false;
        }

        // React: DFS down fiber subtree
        function findReactEditor(node, depth) {
          if (!node || depth > 30) return null;
          const p = node.memoizedProps || node.pendingProps || {};
          if (trySetContent(p.editor)) return p.editor;
          return findReactEditor(node.child, depth + 1) || findReactEditor(node.sibling, depth + 1);
        }

        const fastContainer = document.querySelector('.json-article-editor');
        if (fastContainer) {
          const ffk = Object.getOwnPropertyNames(fastContainer).find(k =>
            k.startsWith('__reactFiber') || k.startsWith('_reactFiber') ||
            k.startsWith('__reactInternalInstance') || k.startsWith('_reactInternalFiber')
          );
          if (ffk) {
            let cur = fastContainer[ffk];
            for (let i = 0; cur && i < 30; i++, cur = cur.return) {
              if (findReactEditor(cur, 0)) return 'ok-react-fast';
            }
          }
        }

        let domNode = editorEl.parentElement;
        while (domNode && domNode !== document.body) {
          // Vue 3: __vueParentComponent
          const v3 = domNode.__vueParentComponent || domNode._vueParentComponent;
          if (v3) {
            let comp = v3;
            for (let i = 0; comp && i < 25; i++, comp = comp.parent) {
              const p = comp.props || {};
              if (trySetContent(p.editor)) return 'ok-vue3-props';
              const ctx = comp.setupState || comp.ctx || {};
              if (trySetContent(ctx.editor)) return 'ok-vue3-ctx';
            }
          }
          // Vue 2: __vue__
          const v2 = domNode.__vue__;
          if (v2) {
            let comp = v2;
            for (let i = 0; comp && i < 25; i++, comp = comp.$parent) {
              if (trySetContent(comp.editor)) return 'ok-vue2';
              if (trySetContent(comp.$props?.editor)) return 'ok-vue2-props';
            }
          }
          // React: getOwnPropertyNames catches non-enumerable fiber keys
          const fk = Object.getOwnPropertyNames(domNode).find(k =>
            k.startsWith('__reactFiber') || k.startsWith('_reactFiber') ||
            k.startsWith('__reactInternalInstance') || k.startsWith('_reactInternalFiber')
          );
          if (fk) {
            let cur = domNode[fk];
            for (let i = 0; cur && i < 25; i++, cur = cur.return) {
              if (findReactEditor(cur, 0)) return 'ok-react';
            }
          }
          domNode = domNode.parentElement;
        }
        // Diagnostic: show what framework keys exist on the parent
        const parent = editorEl.parentElement;
        const parentKeys = parent ? Object.getOwnPropertyNames(parent).filter(k =>
          k.startsWith('__react') || k.startsWith('_react') || k.startsWith('__vue') || k.startsWith('_vue')
        ) : [];
        return 'editor-not-found:' + parentKeys.slice(0, 5).join(',');
      })()`,
      returnByValue: true,
    }, { sessionId });

    await sleep(1500);
    const fiberStatus = fiberResult.result.value;
    console.log(`[binance-article] Component tree result: ${fiberStatus}`);

    if (fiberStatus.startsWith('ok')) {
      const fiberCheck = await cdp.send<{ result: { value: number } }>('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(editorSel)})?.innerText?.length || 0`,
        returnByValue: true,
      }, { sessionId });
      if (fiberCheck.result.value > 50) {
        contentInserted = true;
        console.log(`[binance-article] Content inserted via React fiber (${fiberCheck.result.value} chars)`);
        const fmtRes = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
          expression: `JSON.stringify({ h2: document.querySelector(${JSON.stringify(editorSel)})?.querySelectorAll('h2').length||0, h3: document.querySelector(${JSON.stringify(editorSel)})?.querySelectorAll('h3').length||0, p: document.querySelector(${JSON.stringify(editorSel)})?.querySelectorAll('p').length||0 })`,
          returnByValue: true,
        }, { sessionId });
        const fmt = JSON.parse(fmtRes.result.value);
        console.log(`[binance-article] Format: ${fmt.h2} h2, ${fmt.h3 ?? 0} h3, ${fmt.p} paragraph(s)`);
      }
    }

    if (!contentInserted) {
      // Method 1: Real OS-level paste via system clipboard + AppleScript Cmd+V (trusted event — preserves headings)
      // CDP Input.dispatchKeyEvent does NOT trigger clipboard reads; we need a real OS-level keystroke.
      console.log('[binance-article] Copying HTML to system clipboard...');
      const clipCopied = copyHtmlToClipboard(htmlPath);
      if (clipCopied) {
        console.log('[binance-article] Sending Cmd+V via OS-level keystroke (Google Chrome)...');
        pasteFromClipboard('Google Chrome', 3, 400);

        await sleep(2000);

        const clipCheck = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
          expression: `JSON.stringify({ len: document.querySelector(${JSON.stringify(editorSel)})?.innerText?.length || 0, h2: document.querySelector(${JSON.stringify(editorSel)})?.querySelectorAll('h2').length || 0 })`,
          returnByValue: true,
        }, { sessionId });
        let clipResult: { len: number; h2: number } = { len: 0, h2: 0 };
        try { clipResult = JSON.parse(clipCheck.result.value); } catch {}

        if (clipResult.len > 50) {
          contentInserted = true;
          console.log(`[binance-article] Content inserted via clipboard paste (${clipResult.len} chars, ${clipResult.h2} h2)`);
        } else {
          console.log('[binance-article] Clipboard paste did not produce content, trying fallbacks...');
        }
      } else {
        console.log('[binance-article] Clipboard copy failed, trying fallbacks...');
      }
    }

    if (!contentInserted) {
      // Method 1: DataTransfer paste event
      console.log('[binance-article] Attempting paste via ClipboardEvent...');
      await cdp.send<{ result: { value: boolean } }>('Runtime.evaluate', {
        expression: `(() => {
          const editor = document.querySelector(${JSON.stringify(editorSel)});
          if (!editor) return false;
          const html = ${JSON.stringify(htmlContent)};
          const dt = new DataTransfer();
          dt.setData('text/html', html);
          dt.setData('text/plain', html.replace(/<[^>]*>/g, ''));
          const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
          editor.dispatchEvent(pasteEvent);
          return true;
        })()`,
        returnByValue: true,
      }, { sessionId });

      await sleep(1500);

      const contentCheck = await cdp.send<{ result: { value: number } }>('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(editorSel)})?.innerText?.length || 0`,
        returnByValue: true,
      }, { sessionId });

      if (contentCheck.result.value > 50) {
        contentInserted = true;
        console.log(`[binance-article] Content inserted via paste event (${contentCheck.result.value} chars)`);
        const fmtRes = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
          expression: `JSON.stringify({ h2: document.querySelector(${JSON.stringify(editorSel)})?.querySelectorAll('h2').length||0, h3: document.querySelector(${JSON.stringify(editorSel)})?.querySelectorAll('h3').length||0, p: document.querySelector(${JSON.stringify(editorSel)})?.querySelectorAll('p').length||0 })`,
          returnByValue: true,
        }, { sessionId });
        const fmt = JSON.parse(fmtRes.result.value);
        console.log(`[binance-article] Format: ${fmt.h2} h2, ${fmt.h3 ?? 0} h3, ${fmt.p} paragraph(s)`);
      } else {
        // Method 2: execCommand insertHTML
        console.log('[binance-article] Paste event did not work, trying insertHTML...');
        await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const editor = document.querySelector(${JSON.stringify(editorSel)});
            if (!editor) return false;
            editor.focus();
            document.execCommand('insertHTML', false, ${JSON.stringify(htmlContent)});
            return true;
          })()`,
        }, { sessionId });
        await sleep(1000);

        const check2 = await cdp.send<{ result: { value: number } }>('Runtime.evaluate', {
          expression: `document.querySelector(${JSON.stringify(editorSel)})?.innerText?.length || 0`,
          returnByValue: true,
        }, { sessionId });

        if (check2.result.value > 50) {
          contentInserted = true;
          console.log(`[binance-article] Content inserted via execCommand (${check2.result.value} chars)`);
        } else {
          // Method 3: Manual clipboard paste
          console.log('[binance-article] Auto-insert failed. Copying HTML to clipboard for manual paste (Cmd+V)...');
          copyHtmlToClipboard(htmlPath);
          console.log('[binance-article] Waiting 30s for manual paste...');
          await sleep(30_000);
        }
      }
    }

    // Apply structural formatting (bullet lists, blockquotes) that setContent/paste may not preserve
    if (contentInserted) {
      await applyStructuralFormatting(cdp, sessionId, editorSel, blocks);
    }

    // Replace BSCODEPH_N placeholders with native multiCode nodes. Runs even
    // when contentInserted is false (manual-paste path) — the placeholders may
    // still be present as text, matching how the image loop behaves.
    if (parsed.codeBlocks.length > 0) {
      console.log('[binance-article] Inserting code blocks...');
      await insertCodeBlocks(cdp, sessionId, editorSel, parsed.codeBlocks);
    }

    // Insert content images
    if (parsed.contentImages.length > 0) {
      console.log('[binance-article] Inserting content images...');

      const editorContent = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(editorSel)})?.innerText || ''`,
        returnByValue: true,
      }, { sessionId });

      for (const img of parsed.contentImages) {
        const regex = new RegExp(img.placeholder + '(?!\\d)');
        if (regex.test(editorContent.result.value)) {
          console.log(`[binance-article] Found: ${img.placeholder}`);
        } else {
          console.log(`[binance-article] NOT found: ${img.placeholder}`);
        }
      }

      const getPlaceholderIndex = (placeholder: string): number => {
        const match = placeholder.match(/BSIMGPH_(\d+)/);
        return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
      };
      const sortedImages = [...parsed.contentImages].sort(
        (a, b) => getPlaceholderIndex(a.placeholder) - getPlaceholderIndex(b.placeholder),
      );

      for (let i = 0; i < sortedImages.length; i++) {
        const img = sortedImages[i]!;
        console.log(`[binance-article] [${i + 1}/${sortedImages.length}] Inserting image at placeholder: ${img.placeholder}`);

        const selectPlaceholder = async (maxRetries = 3): Promise<boolean> => {
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            await cdp!.send('Runtime.evaluate', {
              expression: `(() => {
                const editor = document.querySelector(${JSON.stringify(editorSel)});
                if (!editor) return false;
                const placeholder = ${JSON.stringify(img.placeholder)};
                const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null, false);
                let node;
                while ((node = walker.nextNode())) {
                  const text = node.textContent || '';
                  let searchStart = 0;
                  let idx;
                  while ((idx = text.indexOf(placeholder, searchStart)) !== -1) {
                    const afterIdx = idx + placeholder.length;
                    const charAfter = text[afterIdx];
                    if (charAfter === undefined || !/\\d/.test(charAfter)) {
                      const parentElement = node.parentElement;
                      if (parentElement) parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

            await sleep(800);

            const selectionCheck = await cdp!.send<{ result: { value: string } }>('Runtime.evaluate', {
              expression: `window.getSelection()?.toString() || ''`,
              returnByValue: true,
            }, { sessionId });

            const selectedText = selectionCheck.result.value.trim();
            if (selectedText === img.placeholder) {
              console.log(`[binance-article] Selection verified: "${selectedText}"`);
              return true;
            }

            if (attempt < maxRetries) {
              console.log(`[binance-article] Selection attempt ${attempt} got "${selectedText}", retrying...`);
              await sleep(500);
            } else {
              console.warn(`[binance-article] Selection failed after ${maxRetries} attempts, got: "${selectedText}"`);
            }
          }
          return false;
        };

        const selected = await selectPlaceholder(3);
        if (!selected) {
          console.warn(`[binance-article] Skipping image — could not select placeholder: ${img.placeholder}`);
          continue;
        }

        // Delete placeholder
        console.log('[binance-article] Deleting placeholder...');
        await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed) return false;
            if (document.execCommand('delete', false)) return true;
            document.execCommand('insertText', false, '');
            return true;
          })()`,
          returnByValue: true,
        }, { sessionId });

        await sleep(500);

        // Verify deletion; fall back to InputEvent for ProseMirror
        const afterDelete = await cdp.send<{ result: { value: boolean } }>('Runtime.evaluate', {
          expression: `(() => {
            const editor = document.querySelector(${JSON.stringify(editorSel)});
            if (!editor) return true;
            const text = editor.innerText;
            const placeholder = ${JSON.stringify(img.placeholder)};
            const regex = new RegExp(placeholder + '(?!\\\\d)');
            return !regex.test(text);
          })()`,
          returnByValue: true,
        }, { sessionId });

        if (!afterDelete.result.value) {
          console.warn('[binance-article] Placeholder may not have been deleted, trying InputEvent fallback...');
          await selectPlaceholder(1);
          await sleep(300);
          await cdp.send('Runtime.evaluate', {
            expression: `(() => {
              const editor = document.querySelector(${JSON.stringify(editorSel)});
              if (!editor) return;
              editor.focus();
              const beforeEvent = new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true });
              editor.dispatchEvent(beforeEvent);
              const inputEvent = new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true });
              editor.dispatchEvent(inputEvent);
            })()`,
          }, { sessionId });
          await sleep(500);
        }

        // Count images before paste
        const imgCountBefore = await cdp.send<{ result: { value: number } }>('Runtime.evaluate', {
          expression: `document.querySelector(${JSON.stringify(editorSel)})?.querySelectorAll('img').length || 0`,
          returnByValue: true,
        }, { sessionId });

        console.log(`[binance-article] Injecting image: ${path.basename(img.localPath)}`);
        const imgB64 = fs.readFileSync(img.localPath).toString('base64');
        const imgMime = IMG_MIME[path.extname(img.localPath).toLowerCase()] ?? 'image/jpeg';
        await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const editor = document.querySelector(${JSON.stringify(editorSel)});
            if (!editor) return;
            editor.focus();
            const bytes = Uint8Array.from(atob(${JSON.stringify(imgB64)}), c => c.charCodeAt(0));
            const blob = new Blob([bytes], { type: ${JSON.stringify(imgMime)} });
            const file = new File([blob], ${JSON.stringify(path.basename(img.localPath))}, { type: ${JSON.stringify(imgMime)} });
            const dt = new DataTransfer();
            dt.items.add(file);
            editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
          })()`,
        }, { sessionId });
        console.log('[binance-article] Image ClipboardEvent dispatched');

        // Verify image appeared
        console.log('[binance-article] Verifying image upload...');
        const expectedImgCount = imgCountBefore.result.value + 1;
        let imgUploadOk = false;
        const imgWaitStart = Date.now();
        while (Date.now() - imgWaitStart < 30_000) {
          const r = await cdp!.send<{ result: { value: number } }>('Runtime.evaluate', {
            expression: `document.querySelector(${JSON.stringify(editorSel)})?.querySelectorAll('img').length || 0`,
            returnByValue: true,
          }, { sessionId });
          if (r.result.value >= expectedImgCount) { imgUploadOk = true; break; }
          await sleep(1000);
        }

        if (imgUploadOk) {
          console.log(`[binance-article] Image upload verified (${expectedImgCount} image(s))`);
          await sleep(3000);
        } else {
          console.warn('[binance-article] Image upload not detected after 30s');
          if (i === 0) {
            console.warn('[binance-article] First image failed — the editor DOM may have changed. See "DOM Selector Notes" in SKILL.md to update BS_SELECTORS.');
          }
        }
      }

      console.log('[binance-article] All images processed.');
    }

    // Post-composition verification (images + code placeholders)
    if (parsed.contentImages.length > 0 || parsed.codeBlocks.length > 0) {
      console.log('[binance-article] Running post-composition verification...');
      const finalContent = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(editorSel)})?.innerText || ''`,
        returnByValue: true,
      }, { sessionId });

      const remainingPlaceholders: string[] = [];
      for (const ph of [
        ...parsed.contentImages.map((img) => img.placeholder),
        ...parsed.codeBlocks.map((cb) => cb.placeholder),
      ]) {
        const regex = new RegExp(ph + '(?!\\d)');
        if (regex.test(finalContent.result.value)) {
          remainingPlaceholders.push(ph);
        }
      }

      const finalImgCount = await cdp.send<{ result: { value: number } }>('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(editorSel)})?.querySelectorAll('img').length || 0`,
        returnByValue: true,
      }, { sessionId });

      const expectedCount = parsed.contentImages.length;
      const actualCount = finalImgCount.result.value;

      // Positive assertion: count actual multiCode nodes (absence of BSCODEPH_
      // text is not enough — a fully-failed insertion also has no placeholders)
      let multiCodeCount = -1;
      if (parsed.codeBlocks.length > 0) {
        const mcRes = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
          expression: fiberWalkJS('setContent', `
            let c = 0;
            editor.view.state.doc.descendants((n) => { if (n.type.name === 'multiCode') c++; });
            return JSON.stringify({ok:true, count: c});
          `),
          returnByValue: true,
        }, { sessionId });
        try { multiCodeCount = JSON.parse(mcRes.result.value).count ?? -1; } catch {}
      }
      const codeShortfall = multiCodeCount >= 0 && multiCodeCount < parsed.codeBlocks.length;

      if (remainingPlaceholders.length > 0 || actualCount < expectedCount || codeShortfall) {
        console.warn('[binance-article] POST-COMPOSITION CHECK FAILED:');
        if (remainingPlaceholders.length > 0) {
          console.warn(`[binance-article]   Remaining placeholders: ${remainingPlaceholders.join(', ')}`);
        }
        if (actualCount < expectedCount) {
          console.warn(`[binance-article]   Image count: expected ${expectedCount}, found ${actualCount}`);
        }
        if (codeShortfall) {
          console.warn(`[binance-article]   Code blocks: expected ${parsed.codeBlocks.length}, found ${multiCodeCount} multiCode node(s) (plain-text fallback may have been used)`);
        }
        console.warn('[binance-article]   Please check the article before publishing.');
      } else {
        console.log(`[binance-article] Verification passed: ${actualCount} image(s), ${parsed.codeBlocks.length > 0 ? `${multiCodeCount} code block(s), ` : ''}no remaining placeholders.`);
      }
    }

    // Blur editor to trigger save
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const editor = document.querySelector(${JSON.stringify(editorSel)});
        if (editor) { editor.blur(); }
        document.body.click();
      })()`,
    }, { sessionId });
    await sleep(1500);

    if (submit) {
      console.log('[binance-article] Publishing...');
      const pubSelSel = BS_SELECTORS.articlePublishButton;
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const selectors = ${JSON.stringify(pubSelSel)};
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && !el.disabled) { el.click(); return true; }
          }
          const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const btn = Array.from(document.querySelectorAll('button'))
            .filter(isVisible)
            .find(b => /^(publish|post|发布)$/i.test((b.textContent || '').trim()) && !b.disabled);
          if (btn) { btn.click(); return true; }
          return false;
        })()`,
      }, { sessionId });
      await sleep(3000);
      console.log('[binance-article] Article published!');
    } else {
      console.log('[binance-article] Article composed (draft mode). Browser remains open for review.');
    }

  } finally {
    if (cdp) cdp.close();
  }
}

function printUsage(): never {
  console.log(`Publish Markdown article to Binance Square

Usage:
  npx -y bun binance-article.ts <markdown_file> [options]

Options:
  --title <title>       Override title
  --cover <image>       Override cover image
  --submit              Actually publish (default: draft only)
  --profile <dir>       Chrome profile directory
  --chrome-path <path>  Override Chrome executable path
  --no-hashtags         Keep #tags as plain text (skip native hashtag nodes)
  --no-cointags         Keep $SYMBOLs as plain text (skip native coinpair nodes)
  --help                Show this help

Markdown frontmatter:
  ---
  title: My Article Title
  cover_image: /path/to/cover.jpg
  ---

Example:
  npx -y bun binance-article.ts article.md
  npx -y bun binance-article.ts article.md --cover ./hero.png
  npx -y bun binance-article.ts article.md --submit
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
  let chromePath: string | undefined;
  let hashtags = true;
  let coinTags = true;

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
    } else if (arg === '--chrome-path' && args[i + 1]) {
      chromePath = args[++i];
    } else if (arg === '--no-hashtags') {
      hashtags = false;
    } else if (arg === '--no-cointags') {
      coinTags = false;
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

  await publishArticle({ markdownPath, title, coverImage, submit, profileDir, chromePath, hashtags, coinTags });
}

if (import.meta.main) {
  await main().catch((err) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
