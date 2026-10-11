# xArticle publisher companion

This Bun process runs on each user's own computer. It pairs to the private web app, downloads an immutable publication recipe and private assets, verifies every byte, prepares the requested Binance Square or X Chrome editor, waits for explicit approval in the web app, and clicks the final publish control once.

Binance and X login cookies, the Chrome profile path, CDP state, local draft
state, and bundle files never leave this computer. The opaque publisher-device
token is stored only in the operating-system keyring (macOS Keychain, Windows
Credential Manager, or Linux Secret Service) and is sent only to the paired web
origin in an HTTPS `Authorization` header. The server stores its hash, not the
raw token. The config file contains only the API origin and device ID and is
written with private permissions. It lives at
`$XDG_CONFIG_HOME/xarticle-publisher/config.json` (default
`~/.config/xarticle-publisher/`, or `%APPDATA%\xarticle-publisher\` on
Windows). The same directory holds `companion.lock` and, while a publish is in
progress or its result awaits delivery, `pending-result.json`.

Gemini API keys, credential keyrings, encrypted credential records, and source
selection never enter publication recipes, downloaded assets, companion logs,
or companion configuration. The companion is isolated from AI generation
credentials.

The companion supports four independent modes:

- X Post: text with zero to four images, or an image-only post with one to four
  images; text is capped at 280 characters.
- Binance Post: text with zero to four images, or an image-only post with one
  to four images; text is capped at 2,100 characters.
- X Article and Binance Article: required title and body, with an optional
  cover and zero to ten optional body images.

Each mode is materialized from a reviewed, target-and-kind-bound bundle before
the ready state is reported. After approval, the companion revalidates the
exact editor snapshot and begins the server transition immediately before one
scoped publish click. Success requires a kind-matching canonical URL; X uses
`https://x.com/<handle>/status/<numeric-id>` for Posts and
`https://x.com/i/article/<numeric-id>` for Articles. Every ambiguous post-click
result is terminal `outcome_unknown` and is never retried.

The normal paired workflow does not require the user to download a content ZIP.
The companion claims a command and downloads its immutable recipe and private
assets directly from the web API. Content ZIPs remain an optional manual
fallback; the versioned companion ZIP is only a distribution package.

## Local publishing profiles

The companion launches isolated local Chrome publishing profiles; it does not
reuse the user's everyday Chrome profile. The first preparation for each target
opens Chrome so the user can sign in manually. That session then remains only
in the managed profile on the publishing computer.

- X uses `X_BROWSER_PROFILE_DIR`, defaulting to
  `~/.local/share/x-browser-profile` (or the matching XDG data directory).
- Binance Square uses the shared baoyu profile: by default
  `~/Library/Application Support/baoyu-skills/chrome-profile` on macOS,
  `~/.config/baoyu-skills/chrome-profile` on Linux, or
  `%APPDATA%\baoyu-skills\chrome-profile` on Windows. Override it with
  `BAOYU_CHROME_PROFILE_DIR`.

Use dedicated directories and do not point either variable at an everyday
browser profile.

## Install

```bash
cd publisher-companion
bun install --frozen-lockfile
```

After installing from `publisher-companion`, return to the repository root,
install the bundled browser adapters, then run the preflight doctor before
pairing:

```bash
cd ..
cd .agents/skills/baoyu-post-to-binance-square/scripts && bun install --frozen-lockfile
cd ../../baoyu-post-to-x/scripts && bun install --frozen-lockfile
cd ../../../../publisher-companion
bun run doctor
```

The doctor checks Bun, Chrome/Chromium, operating-system keyring access, the
bundled Binance/X adapters, their dependencies, and pairing state. Warnings are
actionable; errors must be fixed before publishing. An unpaired warning is
expected when the doctor runs before the first pairing. Run it again after
pairing and require a ready result before publishing.

Google-enroll in the web app, create a publisher-device pairing code, then pass the one-time code through stdin so it never appears in shell history or the process list. The current production API origin is `https://binance.v27.tech`:

```bash
printf '%s\n' "$PAIRING_CODE" | bun run src/main.ts pair --api https://binance.v27.tech
```

For an interactive terminal, omit the pipe; the prompt disables echo. Pairing
accepts an HTTPS application origin only. Plain `http://localhost` is rejected;
use an HTTPS preview or deployment for an end-to-end local companion test. The
current companion advertises protocol version 2 during pairing; pair it again
after upgrading from a protocol-v1 release so V3 Post/Article commands can be
prepared.

Run one polling cycle:

```bash
bun run src/main.ts run --once
```

Run continuously:

```bash
bun run src/main.ts run
```

The process is single-instance and sequential. It materializes assets, prepares
the appropriate Chrome editor, reports `awaiting_review`, and waits for the web
user to approve the exact revision. It never performs the final click before
that approval.

### Stopping and result delivery

Stop continuous `run` with Ctrl+C or `SIGTERM`. It stops waiting for approval
promptly and cancels a prepared command as `DEVICE_SHUTDOWN`. If the server
transition to publishing had already begun but the click had not happened,
the command is reported as `failed` with `DEVICE_SHUTDOWN`. `run --once` has no
graceful shutdown: Ctrl+C ends the process, and the next run recovers as below.

Just before the final click, and again before reporting the result, the
companion saves a record to `pending-result.json` (private permissions); it
retries result delivery a few times. If the API is still
unreachable, the run ends as `result_pending` and the file stays. The next run
re-delivers that saved result before claiming new work and never clicks again.
A saved record whose command never began publishing is cancelled instead. Do
not delete `pending-result.json` while it exists unless you have confirmed the
outcome in the web app.

If the server permanently rejects a saved record (for example, the command
expired while the computer was offline), or the file is unreadable, the
companion renames it to `pending-result.json.rejected-<time>` or
`.corrupt-<time>`, prints a warning, and continues with new work. Check that
command in the web app; the renamed file keeps the result, including any
published URL.

A 401 stops polling immediately. Check the user's account and workspace
membership first; suspension or removal must be resolved by the owner. If the
device was revoked or its token is invalid, pair it again. Revoke lost or
retired devices under **Account settings → Publishing**; revocation invalidates
polling without deleting the audit row. An ambiguous post-click outcome is
terminal and is never retried.

## Clean-machine package

From the repository root, `npm run publisher:package` creates a deterministic
ZIP and SHA-256 sidecar in `.artifacts/`. Extract the ZIP on the publishing
computer and run `node install.mjs`; the installer installs the companion and
both adapters, then runs the doctor. The package contains no environment file,
device token, Chrome profile, or social credential.
