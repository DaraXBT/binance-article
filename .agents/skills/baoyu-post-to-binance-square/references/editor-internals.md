# Binance Square Article Editor Internals (TipTap / ProseMirror)

These facts are hard-won from debugging — save time if the editor breaks.

## Why paste doesn't preserve formatting

Binance Square's TipTap editor has a `transformPastedHTML` hook that strips `<h2>`, `<ul>`, `<li>`, `<blockquote>` to flat `<p>` during paste. Each `<hr>`-delimited section collapses into ONE paragraph. Clipboard paste (even OS-level trusted events) cannot preserve block structure.

## The fix

`editor.commands.setContent(html, true)` bypasses the paste handler entirely and uses TipTap's schema-aware parser, which preserves all block types.

## How to access the TipTap editor via CDP

```javascript
const container = document.querySelector('.json-article-editor');  // ← fiber is HERE, NOT on .ProseMirror
const fiberKey = Object.keys(container).find(k =>
  k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
let fiber = container[fiberKey];
let editor = null;
for (let i = 0; i < 100 && fiber; i++) {
  const ed = (fiber.memoizedProps ?? fiber.pendingProps)?.editor;
  if (ed?.commands?.setContent && ed?.view) { editor = ed; break; }
  fiber = fiber.return;
}
editor.commands.setContent(html, true);
```

## Key facts

- React fiber key lives on `.json-article-editor` (the container div), **not** on `.ProseMirror` (which has no fiber key)
- Editor is at fiber depth ~4 from the container, via `memoizedProps.editor`
- `pmViewDesc.view` on `.ProseMirror` is `undefined` — use fiber instead
- **Never use `Cmd+Alt+2`** — in Binance Square this applies H2 globally to all content, not just selection

## Verified schema (live dump, 2026-07-13)

**Nodes**: `paragraph`/`heading` (both carry a `textAlign` attr; **heading levels are `[2, 3]` only** — `<h4>`+ degrades to paragraph on parse), `blockquote`, `bulletList`, `orderedList` (`start`/`type` attrs), `listItem`, `horizontalRule`, `hardBreak`, `image` (attrs incl. `width`/`height`/`ratio`/`href`), `imageFigure` (= `image figcaption`; parses from `<figure class="image">`), `figcaption`, `multiCode` (custom code block — see below), `hashtag`, `coinpair`, `mention` (parses from a literal `<mention>` tag), `tradingWidget` (**no parseDOM** — insertable only via `insertTradingWidget` command), `tableRow`/`tableCell`/`tableHeader` — but **no parent `table` node** (`table: false` in the preset), so `<table>` HTML collapses to one concatenated paragraph.

**Marks**: `bold`, `italic`, `strike`, `underline`, `link` (`href`/`target` attrs).

**Extensions worth knowing**: `markdownPaste` (parses pasted plain-text markdown for basics, but **loses code fences** and does not linkify tags — do not rely on it), `textAlign` (left/center/right via `style="text-align: ..."` on `<p>`/`<h2>`/`<h3>`), `imageDomainUpload` (external `<img src>` only loads from Binance CDN domains — upload local files instead).

**Limits**: article body 100,000 characters; cover image 5:2 ratio, JPEG/JPG/PNG only. Editor offers Drafts, Preview, and scheduled publishing.

## Canonical HTML for native inline nodes

These exact attribute names are required — `label="..."` instead of `data-label="..."` parses `label` as `null` and **crashes the editor's node view** (renderSpec `nodeType` TypeError). Recovery: `editor.commands.clearContent()`.

```html
<!-- hashtag -->
<span data-type="hashtag" data-label="#Bitcoin" hashtag="Bitcoin">#Bitcoin</span>
<!-- coinpair ($ coin token) -->
<span data-role="coinpair" data-key="BTC" data-label="$BTC" hashtag="$BTC">$BTC</span>
```

## `multiCode` code blocks (no HTML round-trip)

The schema has no standard `codeBlock`; code lives in a custom `multiCode` node with attrs `{ title: string, blocks: [{ language, content }] }`. Its HTML serialization is lossy (`blocks="[object Object]"`), and parsing `<div data-type="multiCode" blocks='[...]'>` leaves `blocks` as a **string**, not an array. Insert via TipTap JSON instead:

```javascript
editor.chain().focus()
  .deleteRange({ from: placeholderPos, to: placeholderPos + nodeSize })
  .insertContentAt(placeholderPos, {
    type: 'multiCode',
    attrs: { title: '', blocks: [{ language: 'javascript', content: 'const x = 1;' }] },
  })
  .run();
```

`scripts/binance-article.ts` does this for every `BSCODEPH_N` placeholder that `md-to-html.ts` emits for code fences. Success is judged by the multiCode node-count delta, not `run()`'s return value — TipTap chains dispatch their transaction even when a command reports failure. On failure the script falls back to inserting the raw code as plain text, and the post-composition check compares the final multiCode count against the expected number.

## HTML entities in generated content

`md-to-html.ts` keeps the `&#x...;` character references that `remark-stringify` emits around CJK-adjacent emphasis — decoding them before `marked` parses the markdown would make `**bold**` next to CJK render as literal asterisks. The browser decodes these entities when the HTML enters the editor, so any code that matches generated text against the live editor's `textContent` must decode entities first (see `decodeHtmlEntities` in `scripts/binance-article.ts`).

## `BSIMGPH_N` / `BSCODEPH_N` placeholders

After `setContent`, placeholders survive as text nodes inside `<p>` elements. The image insertion loop uses `TreeWalker` to find and replace `BSIMGPH_N`; the code-block loop finds `BSCODEPH_N` paragraphs via `doc.descendants` and swaps them for `multiCode` nodes.
