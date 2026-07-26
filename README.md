# xArticle

xArticle is an invite-only article workspace with reviewed Binance Square and X publishing workflows. The web app manages articles, assets, approvals, and device commands. The paired local publisher companion is the primary path for both targets; validated ZIP downloads remain an optional local fallback.

See [the current architecture guide](./docs/architecture.md) for the active
web-only boundaries, article flow, publication state machine, and release
contract.

See [the dot-grid image loading guide](./docs/dot-grid-image-loading.md) for the
React/TypeScript canvas API, loading-state examples, and integration pitfalls.

See [the workspace Gemini connections guide](./docs/workspace-ai-credentials.md)
for BYOK setup, source selection, encryption keyring rotation, and generation
behavior.

## Trust boundaries

| Location | Stored data |
|---|---|
| Better Auth + Neon PostgreSQL | Users, sessions, workspace membership, article metadata/content, encrypted workspace Gemini credentials, quotas, audit events, publication recipes, command status, and hashes of one-time secrets |
| Private Cloudflare R2 | Article images and generated assets; no public `r2.dev` URLs |
| User's operating-system keyring | Opaque publisher-device bearer token |
| User's computer only | Binance/X cookies, companion-managed Chrome publishing profiles/CDP state, local drafts/journal, prepared bundles, and local file paths |

Binance and X passwords, OAuth tokens, cookies, and Chrome profile data are never stored by the web app, Neon, R2, logs, or exports. Ambiguous Binance or X post-click outcomes become terminal `outcome_unknown` and are never retried.
Users can cancel any pre-click command from the web UI. Expired pre-click commands are atomically reaped during web status checks and companion polling; a command already in `publishing` is never expired or retried.

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
- `GEMINI_API_KEY` is required on the web and article Workflow Worker.
  `DEEPSEEK_API_KEY` is retained only for a dormant internal compatibility path
  and belongs only on the article Workflow Worker; the public generation flow
  currently exposes no DeepSeek selector.
- Workspace BYOK uses the same versioned `AI_CREDENTIAL_KEYRING` and
  `AI_CREDENTIAL_ACTIVE_KEY_ID` bindings on both Workers. A saved key is
  inactive until its workspace owner explicitly selects it in **Settings →
  Connections**.
- Keep the `GEMINI_TEXT_MODEL` and `GEMINI_IMAGE_MODEL` variables identical on
  both Workers so connection validation matches generation.
- Primary Binance and regular X publishing runs only in the local companion.
  Its opaque device token is stored in the operating-system keyring; both social
  sessions stay in isolated, companion-managed local Chrome profiles. On first
  use, the user signs in manually inside the profile opened by the companion.
  X defaults to `~/.local/share/x-browser-profile` and can be overridden with
  `X_BROWSER_PROFILE_DIR`; Binance uses the shared baoyu profile and can be
  overridden with `BAOYU_CHROME_PROFILE_DIR`.
- The companion doctor checks Bun, Chrome/Chromium, OS keyring access, adapter
  dependencies, and pairing state before a browser flow is attempted.

This split lets the web and Workflow Workers scale independently while Neon is
the transaction boundary and R2 is the private binary store. The current
invite-only product policy still caps enrollment at ten active users.

## Article and visual generation flow

The default article path accepts pasted text, a topic prompt, or an HTTPS URL.
The background Workflow Worker then produces structured slides, captions, slide
images, and a dedicated cover. `binance-master` is the default illustration
style; each image selects one of its Scene, Mechanism, Briefing, or Primer
registers based on the content. Binance publication preparation records the
cover focal point; in the paired path, the companion validates and crops the
cover to the Binance 5:2 / 1000×400 contract after claiming the command and
before browser composition. The fallback export performs that crop locally. X
preparation instead selects up to four slide images and does not automatically
attach the dedicated cover.

Generation access can be locked for cost control. In that case an operator
issues a one-time `gac_...` grant; the grant is bound to the user's workspace
and authenticated browser session. The raw grant is shown once and only its
hash and bounded metadata are stored.

## Account and workspace model

- The product interface is English-only. Imported source text and generated
  article content may remain in their original language; stale UI-language
  cookies or browser storage are normalized back to English.
- Enrollment is invitation-only through Google.
- Returning users sign in with Google.
- Suspended or revoked users are rejected on every request.
- The private beta enforces one workspace membership per account and one owner per workspace.
- New workspaces are account-owned and do not issue recovery secrets.
- Pre-account workspaces can be claimed once with their old `dwk_...` key during the database-stamped 30-day migration window. A successful claim consumes the window and deletes legacy browser sessions.

## Binance publishing flow

1. An authenticated member prepares an immutable, revision-bound recipe in the web app.
2. A paired local companion claims the command and verifies every private asset by MIME type, length, magic bytes, and SHA-256.
3. The companion prepares the existing Binance Square skill locally and reports `awaiting_review`.
4. The user approves the exact revision through the web UI.
5. Immediately before the one allowed click, the companion revalidates the editor and calls the server's begin transition.
6. Success requires a canonical Binance Square URL. Any uncertain post-click state is terminal and cannot be retried.

If the companion is unavailable, **Download fallback ZIP** keeps the manual local
bundle workflow available through `.agents/skills/baoyu-post-to-binance-square`.

## X publishing flow

1. An authenticated member opens an article, chooses **X post**, reviews one regular post with up to four images, and selects **Prepare on X**.
2. The paired companion claims the immutable command, verifies every downloaded byte, fills the companion-managed X Chrome composer, and reports `awaiting_review`.
3. The user approves the exact revision through the web UI.
4. Immediately before the one allowed Post click, the companion revalidates the composer and begins the server transition.
5. Success requires an exact `https://x.com/<handle>/status/<numeric-id>` URL. Any uncertain post-click state is terminal and is never retried.

If the companion is unavailable, **Download fallback ZIP** creates only
`post.txt`, selected local images, and a strict SHA-256 manifest. It contains no
cookies, access codes, workspace keys, or remote asset URLs. Run the fallback on
the same computer:

```bash
cd .agents/skills/baoyu-post-to-x/scripts
bun install --frozen-lockfile # first run or after a skill update
cd ../../../..
bun .agents/skills/baoyu-post-to-x/scripts/main.ts --bundle ./article-x-post.zip --dry-run
bun .agents/skills/baoyu-post-to-x/scripts/main.ts --bundle ./article-x-post.zip
```

The fallback skill validates paths, signatures, hashes, and bounded extraction
sizes before opening a local Chrome draft. Review it and click **Post** manually;
the fallback never stores social credentials or claims publication success.

This integration currently supports regular X posts only. X threads and Premium X Articles are separate workflows.

The paired companion path is always review-gated: the web app prepares the
recipe, the user approves the exact revision, and only then can the companion
perform one final click. The app does not silently publish from a browser
session.

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
npm run build
npm run env:check -- --target all
MIGRATION_DATABASE_URL='postgresql://localhost/binance_article' npm run db:check
npm run workflow:dry-run
npm run test:e2e
npm run publisher:package
npm run release:tree-check

cd publisher-companion
bun install --frozen-lockfile
bun run doctor
bun test
bun run typecheck
```

Use [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) for clean-clone release,
database rehearsal, companion distribution, and the controlled smoke-post
procedure.

Authenticated Playwright in CI requires two test-only repository secrets:
`E2E_DATABASE_URL`, pointing to a dedicated disposable PostgreSQL database, and
`E2E_BETTER_AUTH_SECRET`, a stable high-entropy secret of at least 32 characters
used only for that E2E deployment. Never point `E2E_DATABASE_URL` at development or production data and
never reuse a deployed Better Auth secret. CI applies migrations, seeds only its
deterministic E2E principal, and writes the generated browser state under
`.playwright/.auth/`; that state is local and must not be committed. When either
secret is absent, credential-dependent browser tests skip rather than inventing
an account or social credential. See [SETUP_INSTRUCTIONS.md](./SETUP_INSTRUCTIONS.md)
for the equivalent local command.

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
