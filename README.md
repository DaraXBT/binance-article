# xArticle

xArticle is an invite-only article workspace with reviewed Binance Square publishing. The web app manages articles, assets, approvals, and device commands. A local companion uses the user's existing Chrome/Binance login and performs the final publish only after explicit approval.

## Trust boundaries

| Location | Stored data |
|---|---|
| Better Auth + Neon PostgreSQL | Users, sessions, workspace membership, article metadata/content, quotas, audit events, publication recipes, command status, and hashes of one-time secrets |
| Private Cloudflare R2 | Article images and generated assets; no public `r2.dev` URLs |
| User's operating-system keyring | Opaque publisher-device bearer token |
| User's computer only | Binance cookies, Chrome profile/CDP state, local drafts/journal, prepared bundles, and local file paths |
| Telegram | Linked identity and bounded article/device/publication metadata only |

Binance credentials never enter the web app, Neon, R2, Telegram, logs, or exports. Ambiguous post-click outcomes become terminal `outcome_unknown` and are never retried.

## Account and workspace model

- Enrollment is invitation-only through Google.
- Returning users can use Google or a Telegram identity explicitly linked from account settings.
- Suspended or revoked users are rejected on every request.
- The private beta enforces one workspace membership per account and one owner per workspace.
- New workspaces are account-owned and do not issue recovery secrets.
- Pre-account workspaces can be claimed once with their old `dwk_...` key during the database-stamped 30-day migration window. A successful claim consumes the window and deletes legacy browser sessions.

## Binance publishing flow

1. An authenticated member prepares an immutable, revision-bound recipe in the web app.
2. A paired local companion claims the command and verifies every private asset by MIME type, length, magic bytes, and SHA-256.
3. The companion prepares the existing Binance Square skill locally and reports `awaiting_review`.
4. The user approves the exact revision through the web UI or linked Telegram account.
5. Immediately before the one allowed click, the companion revalidates the editor and calls the server's begin transition.
6. Success requires a canonical Binance Square URL. Any uncertain post-click state is terminal and cannot be retried.

Manual bundle export remains available through `.agents/skills/baoyu-post-to-binance-square`.

## Local development

Requirements: Node.js 22+, npm, Bun for the companion, PostgreSQL/Neon, and Chrome for local publishing.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Useful verification commands:

```bash
npm test
npm run typecheck
npm run lint
MIGRATION_DATABASE_URL='postgresql://localhost/binance_article' npm run db:check
npm run telegram:dry-run

cd publisher-companion
bun install --frozen-lockfile
bun test
bun run typecheck
```

Database migrations are an explicit operator action and are never run by an application build:

```bash
MIGRATION_DATABASE_URL='postgresql://...' npm run db:migrate:deploy
```

Do not point migration commands at production until the generated SQL has been reviewed and backed up. See [SETUP_INSTRUCTIONS.md](./SETUP_INSTRUCTIONS.md) and [GETTING_STARTED.md](./GETTING_STARTED.md).
