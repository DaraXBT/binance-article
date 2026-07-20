# xArticle

xArticle is an invite-only article workspace with reviewed Binance Square and X publishing workflows. The web app manages articles, assets, approvals, and device commands. Binance publication uses the local companion; X regular posts are exported as a validated local bundle and composed in the user's existing Chrome session for a final manual review and Post click.

## Trust boundaries

| Location | Stored data |
|---|---|
| Better Auth + Neon PostgreSQL | Users, sessions, workspace membership, article metadata/content, quotas, audit events, publication recipes, command status, and hashes of one-time secrets |
| Private Cloudflare R2 | Article images and generated assets; no public `r2.dev` URLs |
| User's operating-system keyring | Opaque publisher-device bearer token |
| User's computer only | Binance/X cookies, Chrome profile/CDP state, local drafts/journal, prepared bundles, and local file paths |
| Telegram | Linked identity and bounded article/device/publication metadata only |

Binance and X credentials never enter the web app, Neon, R2, Telegram, logs, or exports. Ambiguous Binance post-click outcomes become terminal `outcome_unknown` and are never retried; the X bundle flow does not automate or report the final click.

## Runtime architecture

- The OpenNext web Worker is stateless. Better Auth sessions, membership,
  articles, approvals, jobs, and audit metadata live in Neon PostgreSQL through
  Drizzle.
- Generated assets use opaque database references and a private R2 binding.
  Authenticated routes proxy delivery; the bucket is never exposed through
  `r2.dev`.
- Article generation runs in a separate, non-public Cloudflare Workflow Worker.
  Persisted job IDs are idempotency IDs, and bounded Gemini REST calls send the
  API key only in the `x-goog-api-key` header.
- Binance publication runs only in the local companion. Its opaque device token
  is stored in the operating-system keyring; the browser's Binance session stays
  in the user's local Chrome profile.

This split lets the web and Workflow Workers scale independently while Neon is
the transaction boundary and R2 is the private binary store. The current
invite-only product policy still caps enrollment at ten active users.

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

## X publishing flow

1. An authenticated member opens an article and chooses **X post** beside the Binance Square export action.
2. The dialog preselects one generated `xSingle` caption and up to four generated slide images. The post remains editable and text-only posts are allowed.
3. **Download X post bundle** creates a ZIP containing only `post.txt`, selected local images, and a strict SHA-256 manifest. It does not include cookies, access codes, workspace keys, or remote asset URLs.
4. On the same computer, run the local X skill:

   ```bash
   cd .agents/skills/baoyu-post-to-x/scripts
   bun install --frozen-lockfile # first run or after a skill update
   cd ../../../..
   bun .agents/skills/baoyu-post-to-x/scripts/main.ts --bundle ./article-x-post.zip --dry-run
   bun .agents/skills/baoyu-post-to-x/scripts/main.ts --bundle ./article-x-post.zip
   ```

5. The skill validates paths, signatures, hashes, and bounded extraction sizes before opening a real Chrome draft. Temporary extracted files are removed after composition.
6. Chrome stays open in preview mode. Review the text and images, then click **Post** manually. The app and skill never claim publication success or accept `--submit` for this bundle workflow.

This integration currently supports regular X posts only. X threads and Premium X Articles are separate workflows.

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
npm run workflow:typecheck
npm run lint
MIGRATION_DATABASE_URL='postgresql://localhost/binance_article' npm run db:check
npm run workflow:dry-run
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

Legacy Prisma-era databases must first pass the guarded
`npm run db:baseline:legacy` procedure. Archived Prisma SQL is historical
evidence only; `drizzle/` is the sole forward migration history.

If the baseline audit finds the reviewed Prisma-era JSON columns stored as
`text`, create and verify a restorable backup before running the one-time,
transactional repair. The command validates the exact legacy table set, JSON
syntax and top-level shapes before acquiring short-lived table locks and
converting only those four columns:

```bash
ALLOW_LEGACY_JSON_REPAIR=1 \
CONFIRM_LEGACY_JSON_REPAIR_BACKUP=1 \
MIGRATION_DATABASE_URL='postgresql://...' \
npm run db:repair:legacy-json
```

Run the guarded baseline only after this repair succeeds. Both commands are
explicit operator actions and are never part of an application build.

Do not point migration commands at production until the generated SQL has been reviewed and backed up. See [SETUP_INSTRUCTIONS.md](./SETUP_INSTRUCTIONS.md) and [GETTING_STARTED.md](./GETTING_STARTED.md).
