# xArticle publisher companion

This Bun process runs on each user's own computer. It pairs to the private web app, downloads an immutable publication recipe and private assets, verifies every byte, prepares the existing Binance Square Chrome editor, waits for explicit web/Telegram approval, and clicks Publish once.

Binance login cookies, the Chrome profile path, CDP state, local draft state, bundle files, and the publisher device token never leave this computer. The token is stored only in the operating-system keyring (macOS Keychain, Windows Credential Manager, or Linux Secret Service). The config file contains only the API origin and device ID and is written with private permissions.

## Install

```bash
cd publisher-companion
bun install --frozen-lockfile
```

Google-enroll in the web app, create a publisher-device pairing code, then pass the one-time code through stdin so it never appears in shell history or the process list:

```bash
printf '%s\n' "$PAIRING_CODE" | bun run src/main.ts pair --api https://your-private-app.example
```

For an interactive terminal, omit the pipe; the prompt disables echo.

Run one polling cycle:

```bash
bun run src/main.ts run --once
```

Run continuously:

```bash
bun run src/main.ts run
```

The process is single-instance and sequential. A 401 stops immediately and requires re-pairing. An ambiguous post-click outcome is terminal and is never retried.
