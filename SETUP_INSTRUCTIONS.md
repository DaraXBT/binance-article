# xArticle Setup Instructions

## 1. Install

```bash
npm install
```

Use Node.js 22.18 or newer (the AI-credential rewrap script relies on Node's unflagged TypeScript type stripping). Install Bun separately for `publisher-companion`.

## 2. Configure local environment

Copy `.env.example` to `.env.local`. At minimum configure:

- `DATABASE_URL`: PostgreSQL/Neon runtime URL with TLS for remote hosts.
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`.
- Google OAuth client ID and secret.
- Gemini credentials while the generation provider is enabled.
- `AI_CREDENTIAL_KEYRING` and `AI_CREDENTIAL_ACTIVE_KEY_ID` for encrypted
  workspace Gemini connections. Use the same values on the web and Workflow
  Workers; the keyring maps versioned IDs to base64url 32-byte AES keys.
- Keep `GEMINI_TEXT_MODEL` and `GEMINI_IMAGE_MODEL` identical on both Workers;
  credential validation checks the same models that generation uses.
- Private asset storage credentials/bindings for the selected runtime.

Gemini is the public text provider. `DEEPSEEK_API_KEY` is retained only for a
dormant internal compatibility path and belongs on the article Workflow Worker;
the current public generation flow exposes no DeepSeek selector.

Store production secrets in Cloudflare secret bindings. Do not commit `.env*`, print tokens, or bundle local environment files into Worker output.

After filling local values, validate both runtime targets:

```bash
npm run env:check -- --target all
```

The web target requires the database, Better Auth, Google OAuth, Gemini, and
BYOK keyring values. The Workflow target requires the database, Gemini, and
the same BYOK keyring values. Remote
database URLs must use TLS (`sslmode=require`), and deployed Better Auth URLs
must use HTTPS.

## 3. Database

Use a separate least-privileged runtime role and migration role. Before applying
`0015_workspace_ai_credential`, stage the same `AI_CREDENTIAL_KEYRING`,
`AI_CREDENTIAL_ACTIVE_KEY_ID`, `GEMINI_TEXT_MODEL`, and `GEMINI_IMAGE_MODEL`
values for both Worker deployments. Review migrations, back up deployed data,
then apply with the dedicated URL:

```bash
MIGRATION_DATABASE_URL='postgresql://...' npm run db:check
MIGRATION_DATABASE_URL='postgresql://...' npm run db:migrate:deploy
```

Schema changes are generated offline with `npm run db:generate` (no database
URL needed). Other development commands: `npm run workflow:dev` runs the
article Workflow Worker locally, `npm run cloudflare:build` produces the
OpenNext bundle, `npm run cloudflare:preview` serves it through `wrangler
dev`, and `npm run cloudflare:bundle-check` verifies the compressed Worker
size after a dry-run build.

For the Publication V2 cutover (`0012` through `0014`), briefly stop publication
draft writes and all publisher companions before applying the migrations. Deploy
the V2 web app and companion compatibility release in the same maintenance
window, smoke-test one prepared command, then resume publishing. Do not leave a
V1 web writer running after the one-time legacy-draft backfill; the migration is
expand-only, but it intentionally does not install a permanent dual-write bridge.

The legacy workspace migration stamps only then-unowned workspaces with a 30-day claim deadline. New workspaces receive no claim deadline. Do not edit that deadline per request or extend it with an environment variable.

Migrations `0008` and `0009` contain historical Telegram tables. There is no
active Telegram route, Worker, OAuth flow, or UI in the current product; keep
those migrations and snapshots unchanged so existing databases retain a valid
forward history.

## 4. Better Auth and invitations

Configure the Google callback URL for the deployment origin. On a freshly migrated,
empty database, create the one-time first-owner invitation from an operator shell:

```bash
OPERATOR_DATABASE_URL='postgresql://...' \
BOOTSTRAP_OWNER_EMAIL='owner@example.com' \
BETTER_AUTH_URL='https://articles.example.com' \
npm run owner-bootstrap:create
```

The command refuses databases containing any user or invitation, stores only the
invitation-token hash, and prints the join URL once. The invited Google identity
becomes the sole application owner when it enrolls. Afterwards, create normal
invitations from the owner administration surface. The application limits the
private beta to ten active users plus pending invitations.

## 5. Cloudflare resources

- Deploy the article Workflow Worker first, then deploy the web application as
  an OpenNext Worker from the same commit.
- Bind a private `ARTICLE_ASSETS` R2 bucket; do not enable `r2.dev`.
- Deploy the non-public article Workflow Worker separately and bind it to the
  web Worker by `script_name`.
- Confirm the staged credential keyring and Gemini model values remain identical
  on both Workers. After migration `0015`, deploy the Workflow Worker first,
  then the web Worker. Existing workspaces continue to use platform credits
  until an owner activates a saved key.
- Keep `DEEPSEEK_API_KEY` unset unless an operator-controlled internal workflow
  explicitly enables the dormant compatibility path. Public generation does
  not need this secret.
- Keep migrations outside build and deployment bundles.
- Run the compressed bundle-size gates before deployment.
- Keep observability enabled for both the web and article Workflow Workers.
  `GET /api/health` reports only database availability and should return `200`
  after deployment.

No deployment or live migration is performed by repository verification commands.

## 6. Local publisher companion

The paired companion is the primary publishing path for both Binance Square and
regular X posts. It prepares the local Chrome editor, waits for explicit web
approval of the exact revision, and permits one final click.

```bash
cd publisher-companion
bun install --frozen-lockfile
bun run doctor
printf '%s\n' "$PAIRING_CODE" | bun run src/main.ts pair --api https://your-app.example
bun run src/main.ts run
```

Pass the one-time pairing code through the hidden prompt or stdin, never argv.
The companion accepts an HTTPS application origin only; plain
`http://localhost:3000` cannot be paired. Use an HTTPS preview or deployment
when testing the full web-to-companion path.

The companion refuses plaintext token storage, uses one process lock, verifies
downloaded assets, and never retries a Binance or X publish click. The web app,
database, R2, exports, and companion config never store Binance/X
passwords, OAuth tokens, cookies, or Chrome profile data. Those sessions remain
only in isolated, companion-managed local Chrome publishing profiles; the
opaque publisher-device token is stored only in the operating-system keyring.
The user signs in manually once inside each profile opened by the companion.
X uses `~/.local/share/x-browser-profile` by default and supports
`X_BROWSER_PROFILE_DIR`; Binance uses the platform-specific shared baoyu profile
and supports `BAOYU_CHROME_PROFILE_DIR`. Do not point either setting at an
everyday browser profile.

The API stores only a hash of the opaque device token. The raw token is read
from the OS keyring and sent only in an HTTPS `Authorization` header. Revoke a
device from **Settings → Connections** before retiring a computer; pair again
to replace it.

If the companion is unavailable, use **Download fallback ZIP** in the Binance or
X dialog. Those bounded bundles contain only reviewed post content, local assets,
and integrity metadata. Validate and open them with the matching repository skill
on the same computer; never upload a fallback ZIP to a third-party service.

For a clean-machine release, use the versioned ZIP and SHA-256 sidecar produced
by `npm run publisher:package`, extract it, and run `node install.mjs` from the
artifact root. This avoids installing the entire web repository on the
publishing computer.

The paired path does not require a content ZIP: the companion downloads the
immutable recipe and private assets from the web API after claiming a command.
Fallback content ZIPs are only for manual recovery.

## 7. Authenticated end-to-end tests

Authenticated Playwright and CI require these test-only secrets:

- `E2E_DATABASE_URL`: a dedicated disposable PostgreSQL database. Never use a
  shared development database or any production database.
- `E2E_BETTER_AUTH_SECRET`: a stable, high-entropy Better Auth secret of at
  least 32 characters, used only with that E2E database. Never reuse a deployed
  application secret.

CI maps them to `DATABASE_URL` and `BETTER_AUTH_SECRET`, applies the reviewed
Drizzle migrations, seeds only the deterministic E2E user/workspace/session, and
writes `.playwright/.auth/user.json`. The file is generated with private
permissions and must remain uncommitted. If either secret is absent, tests that
need an authenticated session skip; public and configuration tests still run.

Both secrets are provisioned on this repository: `E2E_DATABASE_URL` points at
the dedicated, data-free Neon branch `e2e-ci` (a schema-only branch of the
production project that was wiped and rebuilt through the migration chain), so
every push runs the full authenticated Playwright suite in CI.

For an equivalent local run, migrate the dedicated database first, then map the
test-only values explicitly:

```bash
MIGRATION_DATABASE_URL="$E2E_DATABASE_URL" npm run db:migrate:deploy

DATABASE_URL="$E2E_DATABASE_URL" \
BETTER_AUTH_SECRET="$E2E_BETTER_AUTH_SECRET" \
BETTER_AUTH_URL='http://127.0.0.1:3100' \
E2E_SEED_AUTH=1 \
E2E_AUTHENTICATED=1 \
E2E_STORAGE_STATE='.playwright/.auth/user.json' \
npm run test:e2e
```

## 8. Verify before release

```bash
npm test
npm run typecheck
npm run workflow:typecheck
npm run lint
npm run build
npm run security:audit
MIGRATION_DATABASE_URL='postgresql://localhost/xarticle' npm run db:check
npm run workflow:dry-run
npm run test:e2e
npm run publisher:package
npm run release:tree-check

cd publisher-companion
bun run doctor
bun test
bun run typecheck
```

Use a clean checkout for OpenNext builds because `.env*` files can be embedded in Worker code. Do not run the Cloudflare build from a checkout containing local secret files.

From that clean checkout, also run `npm run cloudflare:dry-run` with release
bindings supplied through the deployment environment. After deployment, follow
[RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) for migration rehearsal, device
pairing, and controlled Binance/X smoke flows.
