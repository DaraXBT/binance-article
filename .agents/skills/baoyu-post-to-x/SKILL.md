---
name: baoyu-post-to-x
description: Posts content and articles to X (Twitter). Supports regular posts with images/videos and X Articles (long-form Markdown). Uses real Chrome with CDP to bypass anti-automation. Use when user asks to "post to X", "tweet", "publish to Twitter", or "share on X".
---

# Post to X (Twitter)

Posts text, images, videos, and long-form articles to X via real Chrome browser (bypasses anti-bot detection).

## xArticle paired-companion integration

Inside this repository, regular X posts primarily use the paired local
publisher companion. The web app queues an immutable, revision-bound recipe;
the companion downloads and verifies its private assets, materializes a local
bundle, and prepares the live X composer through the local adapter. It then
waits for approval of that exact revision in the web app. After approval, the
adapter revalidates the composer, enters `publishing` immediately before the
action, and performs one scoped Post click. Success requires a canonical X
status URL; an ambiguous post-click result is terminal and is never retried.

The CLI bundle commands below are the standalone/manual fallback: they prepare
a draft but never click Post. They do not replace the paired web approval flow.
Both paths use the isolated `X_BROWSER_PROFILE_DIR` profile (default
`~/.local/share/x-browser-profile`); sign in manually on first use and override
it only with that variable or `--profile`.

## Script Directory

**Important**: All scripts are located in the `scripts/` subdirectory of this skill.

**Agent Execution Instructions**:
1. Determine this SKILL.md file's directory path as `SKILL_DIR`
2. Script path = `${SKILL_DIR}/scripts/<script-name>.ts`
3. Replace all `${SKILL_DIR}` in this document with the actual path
4. Resolve `${BUN_X}` runtime: if `bun` installed → `bun`; if `npx` available → `npx -y bun`; else suggest installing bun

**Script Reference**:
| Script | Purpose |
|--------|---------|
| `scripts/x-browser.ts` | Regular posts (text + images) |
| `scripts/main.ts` | Reviewed xArticle bundle validation and draft composition |
| `scripts/bundle.ts` | Bounded ZIP validation and extraction for reviewed bundles |
| `scripts/bundle-publisher.ts` | Preview-only bundle handoff to `x-browser.ts` |
| `scripts/x-video.ts` | Video posts (text + video) |
| `scripts/x-quote.ts` | Quote tweet with comment |
| `scripts/x-article.ts` | Long-form article publishing (Markdown) |
| `scripts/md-to-html.ts` | Markdown → HTML conversion |
| `scripts/copy-to-clipboard.ts` | Copy content to clipboard |
| `scripts/paste-from-clipboard.ts` | Send real paste keystroke |
| `scripts/check-paste-permissions.ts` | Verify environment & permissions |

## Preferences (EXTEND.md)

Check EXTEND.md existence (priority order):

```bash
# macOS, Linux, WSL, Git Bash
test -f .baoyu-skills/baoyu-post-to-x/EXTEND.md && echo "project"
test -f "$HOME/.baoyu-skills/baoyu-post-to-x/EXTEND.md" && echo "user"
```

```powershell
# PowerShell (Windows)
if (Test-Path .baoyu-skills/baoyu-post-to-x/EXTEND.md) { "project" }
if (Test-Path "$HOME/.baoyu-skills/baoyu-post-to-x/EXTEND.md") { "user" }
```

┌──────────────────────────────────────────────────┬───────────────────┐
│                       Path                       │     Location      │
├──────────────────────────────────────────────────┼───────────────────┤
│ .baoyu-skills/baoyu-post-to-x/EXTEND.md          │ Project directory │
├──────────────────────────────────────────────────┼───────────────────┤
│ $HOME/.baoyu-skills/baoyu-post-to-x/EXTEND.md    │ User home         │
└──────────────────────────────────────────────────┴───────────────────┘

┌───────────┬───────────────────────────────────────────────────────────────────────────┐
│  Result   │                                  Action                                   │
├───────────┼───────────────────────────────────────────────────────────────────────────┤
│ Found     │ Read, parse, apply settings                                               │
├───────────┼───────────────────────────────────────────────────────────────────────────┤
│ Not found │ Use defaults                                                              │
└───────────┴───────────────────────────────────────────────────────────────────────────┘

**EXTEND.md Supports**: Default Chrome profile

## Prerequisites

- Google Chrome or Chromium
- `bun` runtime
- First run: log in to X manually (session saved)

Install the isolated script dependencies once after cloning or updating the skill:

```bash
cd ${SKILL_DIR}/scripts
${BUN_X} install --frozen-lockfile
```

## Pre-flight Check (Optional)

Before first use, suggest running the environment check. User can skip if they prefer.

```bash
${BUN_X} ${SKILL_DIR}/scripts/check-paste-permissions.ts
```

Checks: Chrome, profile isolation, Bun, Accessibility, clipboard, paste keystroke, Chrome conflicts.

**If any check fails**, provide fix guidance per item:

| Check | Fix |
|-------|-----|
| Chrome | Install Chrome or set `X_BROWSER_CHROME_PATH` env var |
| Profile dir | Ensure `~/.local/share/x-browser-profile` is writable |
| Bun runtime | `curl -fsSL https://bun.sh/install \| bash` |
| Accessibility (macOS) | System Settings → Privacy & Security → Accessibility → enable terminal app |
| Clipboard copy | Ensure Swift/AppKit available (macOS Xcode CLI tools: `xcode-select --install`) |
| Paste keystroke (macOS) | Same as Accessibility fix above |
| Paste keystroke (Linux) | Install `xdotool` (X11) or `ydotool` (Wayland) |

## References

- **Regular Posts**: See `references/regular-posts.md` for manual workflow, troubleshooting, and technical details
- **X Articles**: See `references/articles.md` for long-form article publishing guide

---

## Regular Posts

Text + up to 4 images.

```bash
${BUN_X} ${SKILL_DIR}/scripts/x-browser.ts "Hello!" --image ./photo.png
```

**Parameters**:
| Parameter | Description |
|-----------|-------------|
| `<text>` | Post content (positional) |
| `--image <path>` | Image file (repeatable, max 4) |
| `--profile <dir>` | Custom Chrome profile |

**Note**: Script opens browser with content filled in. User reviews and publishes manually.

## Reviewed xArticle bundles

The xArticle web app can export a regular X post as a local ZIP containing one
caption (`post.txt`, maximum 280 characters), up to four generated images, and a SHA-256 manifest. Use
the bundle entry point on the same computer as Chrome:

```bash
${BUN_X} ${SKILL_DIR}/scripts/main.ts --bundle ./article-x-post.zip --dry-run
${BUN_X} ${SKILL_DIR}/scripts/main.ts --bundle ./article-x-post.zip
```

`--dry-run` validates the archive without opening Chrome. The normal command
extracts only the manifest-listed files into a private temporary directory,
composes the text and images in a real Chrome X draft, and removes the temporary
files after composition. Chrome remains open so the user can inspect the draft
and click **Post** themselves.

The reviewed bundle path is intentionally approval-gated:

- `--submit` is rejected by `main.ts`.
- No X cookies, access codes, workspace keys, or remote URLs are accepted from
  the bundle.
- ZIP paths, MIME signatures, SHA-256 hashes, image count, and extracted byte
  limits are checked before Chrome is launched.
- In this standalone fallback, the web page cannot launch local Bun or Chrome;
  download the bundle first and run this command locally. The normal paired
  path instead queues a command for the already-running local companion.

Optional local settings:

```bash
${BUN_X} ${SKILL_DIR}/scripts/main.ts \
  --bundle ./article-x-post.zip \
  --profile "$HOME/.local/share/x-browser-profile" \
  --chrome-path "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

This integration supports regular posts only. `xThread` captions are not
published as a thread, and X Articles remain a separate Premium-only workflow.

---

## Video Posts

Text + video file.

```bash
${BUN_X} ${SKILL_DIR}/scripts/x-video.ts "Check this out!" --video ./clip.mp4
```

**Parameters**:
| Parameter | Description |
|-----------|-------------|
| `<text>` | Post content (positional) |
| `--video <path>` | Video file (MP4, MOV, WebM) |
| `--profile <dir>` | Custom Chrome profile |

**Note**: Script opens browser with content filled in. User reviews and publishes manually.

**Limits**: Regular 140s max, Premium 60min. Processing: 30-60s.

---

## Quote Tweets

Quote an existing tweet with comment.

```bash
${BUN_X} ${SKILL_DIR}/scripts/x-quote.ts https://x.com/user/status/123 "Great insight!"
```

**Parameters**:
| Parameter | Description |
|-----------|-------------|
| `<tweet-url>` | URL to quote (positional) |
| `<comment>` | Comment text (positional, optional) |
| `--profile <dir>` | Custom Chrome profile |

**Note**: Script opens browser with content filled in. User reviews and publishes manually.

---

## X Articles

Long-form Markdown articles (requires X Premium).

```bash
${BUN_X} ${SKILL_DIR}/scripts/x-article.ts article.md
${BUN_X} ${SKILL_DIR}/scripts/x-article.ts article.md --cover ./cover.jpg
```

**Parameters**:
| Parameter | Description |
|-----------|-------------|
| `<markdown>` | Markdown file (positional) |
| `--cover <path>` | Cover image |
| `--title <text>` | Override title |

**Frontmatter**: `title`, `cover_image` supported in YAML front matter.

**Note**: Script opens browser with article filled in. User reviews and publishes manually.

**Post-Composition Check**: The script automatically verifies after all images are inserted:
- Remaining `XIMGPH_` placeholders in editor content
- Expected vs actual image count

If the check fails (warnings in output), alert the user with the specific issues before they publish.

---

## Troubleshooting

### Chrome debug port not ready

If a script fails with `Chrome debug port not ready` or `Unable to connect`,
inspect the process that owns the configured `X_BROWSER_PROFILE_DIR` and
`X_BROWSER_DEBUG_PORT`. Close only a stale process launched for that isolated
profile, or select a different explicit profile/port. Never use a broad
`pkill` against all Chrome or Chromium CDP processes; another session may
belong to the user or another skill.

## Notes

- First run: manual login required (session persists)
- Direct regular, video, quote, and article scripts preview by default; use
  their explicit `--submit` option only after fresh final confirmation
- The reviewed `scripts/main.ts --bundle` entry point only fills the draft,
  never accepts `--submit`, and never claims a published URL
- Cross-platform: macOS, Linux, Windows

## Extension Support

Custom configurations via EXTEND.md. See **Preferences** section for paths and supported options.
