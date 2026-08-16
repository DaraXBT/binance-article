# xArticle

xArticle is an invite-only personal article studio with reviewed Binance Square and X publishing workflows. Each login has a private article library, AI connection, and publishing devices. The paired local publisher companion is the primary path for both targets; validated ZIP downloads remain an optional local fallback.

## Documentation

- [Getting started](./GETTING_STARTED.md) — enrollment, personal library, generation,
  and reviewed publishing flows.
- [Setup instructions](./SETUP_INSTRUCTIONS.md) — local environment, database,
  Cloudflare deployment, companion setup, and verification.
- [Release checklist](./RELEASE_CHECKLIST.md) — clean-clone gates, deployment,
  smoke tests, and rollback.
- [Current architecture](./docs/architecture.md) — active runtime boundaries,
  state machines, and release contract.
- [Cloudflare edge security](./docs/cloudflare-security-config.md) — rate limits,
  bindings, production origin, and observability.
- [Generation access](./docs/generation-access.md) — one-time grants, rotation,
  and protected endpoints.
- [Account Gemini connections](./docs/workspace-ai-credentials.md) — BYOK
  selection, encryption-key rotation, and deployment order.
- [Dot-grid image loading](./docs/dot-grid-image-loading.md) — canvas API,
  loading-state examples, and integration pitfalls.
- [Publisher companion](./publisher-companion/README.md) — installation,
  pairing, local browser profiles, and clean-machine packaging.

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

- Production is the Cloudflare OpenNext Worker at
  `https://binance.v27.tech`; `wrangler.jsonc` owns the custom-domain binding.
  Git-triggered Vercel deployments are disabled because that runtime does not
  have the required Workflow or private R2 bindings.
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
- Account BYOK uses the same versioned `AI_CREDENTIAL_KEYRING` and
  `AI_CREDENTIAL_ACTIVE_KEY_ID` bindings on both Workers. A saved key is
  inactive until the user explicitly selects **Your Gemini key** in **Settings →
  Connections**.
- Keep the `GEMINI_TEXT_MODEL` and `GEMINI_IMAGE_MODEL` variables identical on
  both Workers so connection validation matches generation.
- Primary Binance and X publishing, for both Posts and Articles, runs only in
  the local companion.
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
registers based on the content. For either platform, a Post may be text-only,
image-only, or contain both, with zero to four optional images; X text is capped
at 280 characters and Binance text at 2,100. Articles require title and body,
while their cover and zero to ten body images are independently optional.
Binance cover preparation records the focal point and the companion validates
and crops a selected cover to the 5:2 / 1000×400 contract before composition.

Generation access can be locked for cost control. In that case an operator
issues a one-time `gac_...` grant; the grant is bound to the user's internal
personal tenant and authenticated browser session. The raw grant is shown once
and only its hash and bounded metadata are stored.

## Account and internal tenancy model

- The product interface is English-only. Imported source text and generated
  article content may remain in their original language; stale UI-language
  cookies or browser storage are normalized back to English.
- xArticle administrators manage enrollment in **Settings → Connections**.
  After the one-time bootstrap invitation on an empty database, administrators create one
  reusable shared `JOIN-...` code and privately distribute its `#code=` URL.
  Only an HMAC hash is stored. A code claim is short-lived and becomes an active
  account only after verified Google sign-in; rotating a code invalidates every
  unfinished claim made with the previous version. Existing legacy invitation
  links remain usable until expiry or revocation.
- Every successful code enrollment creates a separate personal account and
  private article library. A code grants application access; it never joins the
  user to another person's content.
- Returning users sign in with Google. Unknown users are directed to **Join
  with an access code**, and draft return paths survive the enrollment flow.
- Suspended or revoked users are rejected on every request.
- The account control stays pinned to the bottom of the article rail. Select
  **Settings** there to open the responsive **Connections** panel for Gemini
  credentials, publisher devices, and administrator controls. In the collapsed
  desktop rail, the same menu opens beside the account icon rather than moving
  into the article list.
- `/workspace` remains the canonical signed-in route. Internally, the database
  retains one workspace namespace per account for tenant isolation, encrypted
  credential binding, legacy recovery, audit history, and stable R2 keys; users
  never create, select, or share that namespace.
- The private beta enforces one internal workspace membership per account and
  one owner per internal workspace.
  Its capacity counts active users, live legacy invitations, and live reserved
  enrollment claims; unreserved pending claims do not consume a seat.
- New personal tenants are provisioned automatically and do not issue recovery
  secrets.
- Eligible pre-account data can be imported once with its old `dwk_...` key
  during the database-stamped recovery window. The UI labels this **Import old
  data** and offers it only when the server confirms eligibility.

## Binance publishing flow

1. A signed-in user chooses **Post** or **Article**, reviews the exact
   text/title/body and optional media, and prepares an immutable,
   revision-bound recipe in the web app.
2. A paired local companion claims the command and verifies every private asset by MIME type, length, magic bytes, and SHA-256.
3. The companion prepares the matching Binance Square Post composer or Article
   editor locally and reports `awaiting_review`.
4. The user approves the exact revision through the web UI.
5. Immediately before the one allowed click, the companion revalidates the editor and calls the server's begin transition.
6. Success requires a canonical, kind-matching Binance Square URL. Any
   uncertain post-click state is terminal and cannot be retried.

For formats where the dialog offers it, **Download fallback ZIP** keeps the
manual local bundle workflow available through
`.agents/skills/baoyu-post-to-binance-square`.

## X publishing flow

1. A signed-in user chooses **Post** or **Article**, reviews the exact
   content and optional media, and selects **Prepare on X**. Articles require
   the publishing account to have X Articles entitlement.
2. The paired companion claims the immutable command, verifies every downloaded
   byte, fills the companion-managed X Post composer or Article editor, and
   reports `awaiting_review`.
3. The user approves the exact revision through the web UI.
4. Immediately before the one allowed click, the companion revalidates the
   exact editor snapshot and begins the server transition.
5. Success requires `https://x.com/<handle>/status/<numeric-id>` for a Post or
   `https://x.com/i/article/<numeric-id>` for an Article. Any uncertain
   post-click state is terminal and is never retried.

If the companion is unavailable, **Download fallback ZIP** creates only
`post.txt`, selected local images, and a strict SHA-256 manifest. It contains no
cookies, access codes, legacy recovery keys, or remote asset URLs. Run the fallback on
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

X threads remain outside this workflow. If the managed X account lacks Article
entitlement, only X Article preparation is cancelled; regular X Posts remain
available.

The paired companion path is always review-gated: the web app prepares the
recipe, the user approves the exact revision, and only then can the companion
perform one final click. The app does not silently publish from a browser
session.

## Local development

Requirements: Node.js 22.18+, npm, Bun for the companion, PostgreSQL/Neon, and Chrome for local publishing.

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
MIGRATION_DATABASE_URL='postgresql://localhost/xarticle' npm run db:check
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
an account or social credential. Both secrets are provisioned on this
repository (the database is the dedicated data-free Neon branch `e2e-ci`), so
CI runs the complete authenticated suite on every push. See
[SETUP_INSTRUCTIONS.md](./SETUP_INSTRUCTIONS.md) for the equivalent local
command.

Database migrations are an explicit operator action and are never run by an application build:

```bash
: "${MIGRATION_DATABASE_URL:?Load the migration-role URL securely first}"
npm run db:migrate:deploy
unset MIGRATION_DATABASE_URL
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
: "${MIGRATION_DATABASE_URL:?Load the migration-role URL securely first}"
ALLOW_LEGACY_JSON_REPAIR=1 \
CONFIRM_LEGACY_JSON_REPAIR_BACKUP=1 \
npm run db:repair:legacy-json
unset MIGRATION_DATABASE_URL
```

Run the guarded baseline only after this repair succeeds. Both commands are
explicit operator actions and are never part of an application build.

Do not point migration commands at production until the generated SQL has been reviewed and backed up. See [SETUP_INSTRUCTIONS.md](./SETUP_INSTRUCTIONS.md) and [GETTING_STARTED.md](./GETTING_STARTED.md).
