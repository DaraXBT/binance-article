---
name: baoyu-post-to-binance-square
description: Posts content and articles to Binance Square (https://www.binance.com/en/square). Supports regular posts, long-form Markdown, and validated xarticle ZIP bundles with a review-confirm-publish boundary through real Chrome CDP. Use whenever the user asks to post, export, prepare, review, or publish to Binance Square, mentions a Binance article bundle, or says "发布到币安广场".
metadata:
  version: 1.3.0
  upstream:
    repository: https://github.com/DaraXBT/baoyu-skills
    commit: a37d82f6105f696d511ba11e36e6372fbb0c1644
  openclaw:
    homepage: https://github.com/JimLiu/baoyu-skills#baoyu-post-to-binance-square
    requires:
      anyBins:
        - bun
        - npx
---

# Post to Binance Square

Posts text, images, and long-form Markdown articles to Binance Square via real Chrome browser (bypasses anti-bot detection).

This project-local copy is pinned to upstream commit `a37d82f6105f696d511ba11e36e6372fbb0c1644` and adds a validated export-bundle workflow. Keep bundles and draft state local; never upload them or print cookies, workspace keys, or CDP credentials.

## xArticle paired-companion integration

Inside this repository, the primary web workflow is the paired local publisher
companion, not a downloaded content ZIP. The web app queues an immutable,
revision-bound recipe; the companion downloads and verifies its private assets,
materializes a local bundle, and invokes this skill's prepare adapter. After the
live Binance editor is ready, the companion waits for approval of that exact
revision in the web app. Only then does it invoke the publish adapter, with the
server's `publishing` transition immediately before the one scoped click.

The CLI bundle commands documented below remain the standalone/manual fallback.
They keep their own review and fresh-confirmation rules and must not be treated
as evidence that the web app can launch Chrome. Both paths use the locally
managed baoyu Chrome profile; sign in manually on first use and override its
location only with `BAOYU_CHROME_PROFILE_DIR` or `--profile`.

## User Input Tools

When this skill needs the user to make a choice (publish confirmation, fallback selection, etc.):

1. **Prefer built-in user-input tools** if the current agent runtime exposes one — e.g., `AskUserQuestion`, `request_user_input`, `clarify`, `ask_user`, or any equivalent.
2. **Fallback to plain text**: if no such tool exists, emit a numbered plain-text message and ask the user to reply with the chosen number/answer for each question.
3. **Batching rule**:
   - If the tool supports **multiple questions per call** (e.g., `AskUserQuestion`): **Combine all applicable questions into a single call. Do NOT split into separate calls.**
   - If the tool supports **only one question per call** (e.g., single-prompt `clarify`): ask **one question per call, in priority order**.

Specific mentions of a concrete tool in this skill are examples — other runtimes substitute their local equivalent under this rule.

## Script Directory

**Important**: All scripts are located in the `scripts/` subdirectory of this skill.

**Agent Execution Instructions**:
1. Determine this SKILL.md file's directory path as `{baseDir}`
2. Script path = `{baseDir}/scripts/<script-name>.ts`
3. Replace all `{baseDir}` in this document with the actual path
4. Resolve `${BUN_X}` runtime: if `bun` installed → `bun`; if `npx` available → `npx -y bun`; else suggest installing bun
5. If `{baseDir}/scripts/node_modules` is missing, run `${BUN_X} install --frozen-lockfile` from `{baseDir}/scripts` before invoking the publisher

**Script Reference**:
| Script | Purpose |
|--------|---------|
| `scripts/main.ts` | Unified entry point — routes to browser or article mode |
| `scripts/binance-browser.ts` | Regular posts (text + images) |
| `scripts/binance-article.ts` | Long-form article publishing (Markdown) |
| `scripts/binance-utils.ts` | Shared Chrome/CDP utilities and DOM selectors |
| `scripts/md-to-html.ts` | Markdown → HTML conversion: h2/h3 mapping, collision-resistant image/code placeholders, #tag/$COIN spans, table degrade |
| `scripts/copy-to-clipboard.ts` | Copy image/HTML to system clipboard |
| `scripts/paste-from-clipboard.ts` | Send real Cmd+V/Ctrl+V keystroke |
| `scripts/check-paste-permissions.ts` | Pre-flight environment check |
| `scripts/bundle.ts` | ZIP validation, bounded extraction, hashes, and manifest checks |
| `scripts/bundle-publisher.ts` | Two-stage prepare/review/publish flow |
| `scripts/draft-state.ts` | Expiring local draft state |

## Prerequisites

- Google Chrome or Chromium
- `bun` runtime
- Skill dependencies installed with `bun install --frozen-lockfile` from `scripts/`
- First run: log in to Binance manually in the opened Chrome window (session saved in shared profile)

## Pre-flight Check (Optional)

Before first use, suggest running the environment check. User can skip if they prefer.

```bash
${BUN_X} {baseDir}/scripts/check-paste-permissions.ts
```

Checks: Chrome, profile isolation, Bun, Accessibility, clipboard, paste keystroke, Chrome conflicts.

**If any check fails**, provide fix guidance per item:

| Check | Fix |
|-------|-----|
| Chrome | Install Chrome or set `BS_CHROME_PATH` env var |
| Profile dir | Shared profile (default: `~/Library/Application Support/baoyu-skills/chrome-profile` on macOS, `~/.config/baoyu-skills/chrome-profile` on Linux, `%APPDATA%\baoyu-skills\chrome-profile` on Windows); override with `BAOYU_CHROME_PROFILE_DIR` |
| Bun runtime | `brew install oven-sh/bun/bun` (macOS) or `npm install -g bun` |
| Accessibility (macOS) | System Settings → Privacy & Security → Accessibility → enable terminal app |
| Clipboard copy | Ensure Swift/AppKit available (macOS Xcode CLI tools: `xcode-select --install`) |
| Paste keystroke (macOS) | Same as Accessibility fix above |
| Paste keystroke (Linux) | Install `xdotool` (X11) or `ydotool` (Wayland) |

## Preferences (EXTEND.md)

Check EXTEND.md in priority order — the first one found wins:

| Priority | Path | Scope |
|----------|------|-------|
| 1 | `.baoyu-skills/baoyu-post-to-binance-square/EXTEND.md` | Project |
| 2 | `${XDG_CONFIG_HOME:-$HOME/.config}/baoyu-skills/baoyu-post-to-binance-square/EXTEND.md` | XDG |
| 3 | `$HOME/.baoyu-skills/baoyu-post-to-binance-square/EXTEND.md` | User home |

If none found, use defaults.

**EXTEND.md supports**: Default Chrome profile, default hashtags

## Publish Safety

Never click Publish/Post without explicit final confirmation. In the paired
xArticle companion, authenticated web approval of the exact immutable revision
is that confirmation, and the server must enter `publishing` immediately before
the scoped click. In standalone agent/CLI use, confirmation must be fresh in the
current conversation. For generated article bundles, use the two-stage flow
below. Preparation may open Chrome and compose a draft, but it must leave the
browser open and return an expiring draft ID. Ask the user to review the live
Binance editor; only then run `--publish-draft <id>`. If the editor changed, the
draft expired, or success is ambiguous, stop and report the issue.

## Browser-generated Article Bundles (recommended)

The xarticle app exports a ZIP containing `article.md`, `manifest.json`, a 5:2 JPEG cover, and ordered slide images. Validate the archive before opening Chrome:

```bash
${BUN_X} {baseDir}/scripts/main.ts --bundle ./article-binance-square.zip --dry-run
${BUN_X} {baseDir}/scripts/main.ts --bundle ./article-binance-square.zip
```

The second command composes a draft and prints a short-lived ID. Tell the user exactly what was prepared and ask for fresh confirmation. After confirmation, publish only that ID:

```bash
${BUN_X} {baseDir}/scripts/main.ts --publish-draft <draft-id>
```

The publisher reattaches only to the recorded Binance editor tab, checks title/body/assets again, uses scoped article-editor selectors, and reports success only after a canonical published URL or a recognized success state. It never launches a replacement tab for the publish step and never kills unrelated Chrome processes.

Bundle limits are deliberately bounded: 100 MiB compressed/extracted total, 32 entries, 20 images, 10 MiB per image, 1 MiB Markdown, and 256 KiB manifest. ZIP paths must be relative, listed in the manifest, non-symlink, and match verified image signatures and SHA-256 hashes.

Bundle Markdown uses only canonical inline image destinations (`![alt](images/file.ext)`). Each listed image path must appear exactly once; remote, absolute, resource-loading raw HTML, reference/wiki, escaped, Mermaid-generated, or image-like code/alt destinations are rejected before any browser or filesystem image resolution. Plain formatting tags such as `<u>` remain allowed. Mermaid fences remain available in direct article preview, but the reviewed bundle flow rejects them until their generated PNG is explicitly included in the manifest.

## Post Type Selection

Unless the user explicitly specifies the post type:
- **Plain text** (+ optional images) → **Regular Post**
- **Markdown file** (.md) → **Article**

---

## Regular Posts

```bash
${BUN_X} {baseDir}/scripts/main.ts "Hello Binance Square!"
${BUN_X} {baseDir}/scripts/main.ts "Check this out" --image ./chart.png
${BUN_X} {baseDir}/scripts/main.ts "Post it!" --image a.png --image b.png --submit
${BUN_X} {baseDir}/scripts/main.ts "BTC ATH!" --tag bitcoin --tag crypto --submit
```

**Parameters**:
| Parameter | Description |
|-----------|-------------|
| `<text>` | Post content (positional) |
| `--image <path>` | Image file (can be repeated) |
| `--tag <hashtag>` | Hashtag to append (can be repeated; `#` prefix optional) |
| `--submit` | Auto-publish (default: preview only) |
| `--profile <dir>` | Custom Chrome profile directory |
| `--chrome-path <path>` | Override Chrome executable path |

**Note**: Script opens browser with content filled in. User reviews and publishes manually unless `--submit` is passed (see **Publish Safety**).

---

## Long-form Articles

Publishes a Markdown file as a Binance Square article. The script:
1. Parses Markdown into HTML with a fresh random placeholder namespace for images and code fences
2. Opens Chrome to Binance Square and navigates to the article editor
3. Fills in the title from frontmatter or the first H1 heading
4. Injects HTML via `editor.commands.setContent()` accessed through React fiber (Method 0 — preserves all block formatting). Falls back to clipboard paste methods if fiber is unavailable.
5. Replaces each code placeholder with a native `multiCode` code-block node via TipTap `insertContentAt` (falls back to plain text if the node insert fails — the hard post-composition check reports the shortfall)
6. Inserts each image by selecting its placeholder and pasting via clipboard

```bash
${BUN_X} {baseDir}/scripts/main.ts --article article.md
${BUN_X} {baseDir}/scripts/main.ts --article article.md --cover ./hero.png
```

**Parameters**:
| Parameter | Description |
|-----------|-------------|
| `--article <file>` | Markdown file path |
| `--cover <path>` | Cover image (overrides frontmatter) |
| `--title <text>` | Override title |
| `--submit` | Disabled for article mode; use the bundle two-stage flow |
| `--profile <dir>` | Custom Chrome profile directory |
| `--chrome-path <path>` | Override Chrome executable path |
| `--no-hashtags` | Keep `#tags` as plain text (default: converted to native hashtag nodes) |
| `--no-cointags` | Keep `$SYMBOLs` as plain text (default: converted to native coinpair nodes) |

**Markdown formatting support** (matches the editor's verified TipTap schema):
| Markdown | Rendered as |
|----------|-------------|
| `## H2` | `<h2>` heading |
| `### H3` and deeper | `<h3>` heading (the editor only supports levels 2–3) |
| Bold / italic / strikethrough | Native marks (`<u>` underline also survives via inline HTML) |
| Lists, blockquotes, `---` | Native nodes |
| Code fences | Native `multiCode` code-block widget (language label preserved) |
| Tables | Degraded to a blockquote grid — the editor has **no table node** |
| `#Tag` (incl. CJK) | Native hashtag node (styled, clickable) |
| `$BTC` (uppercase letter + 1–9 uppercase letters/digits) | Native coinpair token |
| Images | Uploaded via clipboard paste at placeholder positions |
| Mermaid fences | Rendered to PNG and inserted as images |

**Platform limits** (verified 2026-07): article body max 100,000 characters; cover image 5:2 ratio, JPEG/JPG/PNG.

**Markdown frontmatter**:
```yaml
---
title: My Article Title
cover_image: /path/to/cover.jpg
---
```

**Post-composition check**: After all code blocks and images are inserted the script verifies that no generated placeholders remain, the title/body match, and image/code counts match. Any failure is a hard stop.

**Publish safety**: Direct article `--submit` is rejected. Use `--bundle`, obtain fresh confirmation after browser review, and then use `--publish-draft`.

---

## Article Editor Internals (TipTap / ProseMirror)

The editor's `transformPastedHTML` hook strips all block structure during paste (headings, lists, blockquotes collapse to flat `<p>`), so clipboard paste — even OS-level trusted events — cannot preserve formatting. The reliable path is `editor.commands.setContent(html, true)` via the React fiber on `.json-article-editor` (Method 0 in the script). If the editor breaks or the DOM changes, see [references/editor-internals.md](references/editor-internals.md) for the fiber-walk snippet, confirmed schema node types, and debugging notes.

---

## Chrome Debug Port Error

If a script fails with `Chrome debug port not ready` or `Unable to connect`, inspect the configured profile and existing CDP port. Do not kill processes automatically: an existing session may belong to the user or another skill. Ask the user to close a stale session or provide `BAOYU_CHROME_PROFILE_DIR`/`BS_BROWSER_DEBUG_PORT` explicitly.

---

## DOM Selector Notes

Binance Square's DOM may change. If the script cannot find the compose area or editor, the user should:
1. Open Binance Square in Chrome DevTools
2. Inspect the element for the compose textarea or article editor
3. Update the selector arrays in `scripts/binance-utils.ts` (`BS_SELECTORS` constant)

The script tries multiple fallback selectors automatically, so most updates will survive minor UI changes.

---

## Notes

- First run: manual login required (session persists in shared Chrome profile). The scripts auto-accept Binance's cookie-consent banner on cold launches
- Article bundle scripts always stop for browser review and require a separate `--publish-draft` command (see **Publish Safety**)
- Cross-platform: macOS, Linux, Windows (paste keystroke uses platform-appropriate method)
- Chrome profile is shared with other `baoyu-post-to-*` skills via `BAOYU_CHROME_PROFILE_DIR` env var or default path
