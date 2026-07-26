# xArticle publisher companion

This Bun process runs on each user's own computer. It pairs to the private web app, downloads an immutable publication recipe and private assets, verifies every byte, prepares the requested Binance Square or X Chrome editor, waits for explicit approval in the web app, and clicks the final publish control once.

Binance and X login cookies, the Chrome profile path, CDP state, local draft
state, and bundle files never leave this computer. The opaque publisher-device
token is stored only in the operating-system keyring (macOS Keychain, Windows
Credential Manager, or Linux Secret Service) and is sent only to the paired web
origin in an HTTPS `Authorization` header. The server stores its hash, not the
raw token. The config file contains only the API origin and device ID and is
written with private permissions.

Gemini API keys, credential keyrings, encrypted credential records, and source
selection never enter publication recipes, downloaded assets, companion logs,
or companion configuration. The companion is isolated from AI generation
credentials.

The companion supports Binance Square long-form articles and regular X posts.
X commands have hard limits of 280 characters and four images; they are
materialized as reviewed X post bundles and filled into the live composer
before the ready state is reported. After approval, the companion begins the
server transition immediately before one scoped Post click. Only an exact
`https://x.com/<handle>/status/<numeric-id>` URL is accepted as success; every
ambiguous post-click result is terminal `outcome_unknown` and is never retried.

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

Google-enroll in the web app, create a publisher-device pairing code, then pass the one-time code through stdin so it never appears in shell history or the process list:

```bash
printf '%s\n' "$PAIRING_CODE" | bun run src/main.ts pair --api https://your-private-app.example
```

For an interactive terminal, omit the pipe; the prompt disables echo. Pairing
accepts an HTTPS application origin only. Plain `http://localhost` is rejected;
use an HTTPS preview or deployment for an end-to-end local companion test.

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

A 401 stops polling immediately. Check the user's account and workspace
membership first; suspension or removal must be resolved by the owner. If the
device was revoked or its token is invalid, pair it again. Revoke lost or
retired devices under **Settings → Connections**; revocation invalidates
polling without deleting the audit row. An ambiguous post-click outcome is
terminal and is never retried.

## Clean-machine package

From the repository root, `npm run publisher:package` creates a deterministic
ZIP and SHA-256 sidecar in `.artifacts/`. Extract the ZIP on the publishing
computer and run `node install.mjs`; the installer installs the companion and
both adapters, then runs the doctor. The package contains no environment file,
device token, Chrome profile, or social credential.
