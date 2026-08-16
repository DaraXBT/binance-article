# xArticle release checklist

Use a clean clone for every release. The repository intentionally fails the
tree check when migrations or companion sources exist only as local files.

## Build and verify

```bash
npm ci
npm run release:tree-check
npm run env:check -- --target all
npm test
npm run typecheck
npm run workflow:typecheck
npm run lint
npm run security:audit
npm run build
npm run test:e2e
npm run db:check
npm run publisher:package
npm run workflow:dry-run
npm run cloudflare:dry-run
```

Verify the companion and both bundled browser adapters as independent release
units:

```bash
cd publisher-companion
bun install --frozen-lockfile
bun test
bun run typecheck
bun run doctor

cd ../.agents/skills/baoyu-post-to-binance-square/scripts
bun install --frozen-lockfile
bun test
npx tsc -p tsconfig.typecheck.json

cd ../../baoyu-post-to-x/scripts
bun install --frozen-lockfile
bun test

cd ../../../..
```

An unpaired warning from the companion doctor is expected on a clean release
machine. Rerun the doctor after pairing and require a ready result before any
publishing smoke test. A Playwright run that skips the credential-dependent
authenticated specs (they self-skip per test when the E2E secrets are absent)
is not a complete release pass. CI runs the full authenticated suite by
default against the dedicated `e2e-ci` Neon branch; for local runs, follow
the environment mapping in SETUP_INSTRUCTIONS.md and confirm in the report
that the authenticated specs ran instead of skipping.

Playwright reports and test results are uploaded only when CI fails and expire
after seven days. The absence of a report artifact on a green run is expected.
After pushing the final release commit, require a green CI run whose head SHA is
that exact commit before touching production. GitHub may replace an older
pending run in the shared-database concurrency group; rerun the exact SHA if
that happens, and never substitute a green run from another commit.

Publish the ZIP and its `.sha256` sidecar from `.artifacts/` with the same
version as `publisher-companion/package.json`. On a clean computer, extract the
ZIP and run `node install.mjs`; it installs the companion and both browser
adapters, then runs the companion doctor.

Verify the artifact before distribution:

```bash
cd .artifacts
shasum -a 256 -c xarticle-publisher-companion-0.1.0.zip.sha256
```

Use the version from `publisher-companion/package.json`; do not copy the sample
version blindly after a version bump.

## Database and deployment

Determine the production migration ledger before selecting any procedure:

- If it ends at `0015`, do not run migrations from a checkout whose journal
  contains `0017`. Use the exact CI-green release whose journal ends at `0016`,
  follow the [0016 cutover runbook](./docs/cutover-0016-runbook.md) through its
  deployment and smoke tests, and verify the ledger ends at `0016`. Conduct
  `0017` in a separate maintenance window afterward.
- If it ends at `0016`, follow the dedicated
  [0017 publication-kind cutover runbook](./docs/cutover-0017-runbook.md).
  Freeze and drain publication writes, apply and verify `0017` from an exact
  CI-green checkout whose journal ends at `0017`, then continue directly to
  the [0018 credential-constraint repair](./docs/cutover-0018-runbook.md)
  before deploying the final web Worker.
- If it ends at `0017`, follow the `0018` repair runbook. Do not rerun `0017`.
- If it already includes `0018`, do not rerun any cutover migration.
- Abort on every other ledger state or any schema drift.

Never run the 0016 procedure from a checkout whose journal contains `0017`:
`db:migrate:deploy` applies every pending migration. After `0017` commits, never
restore a pre-0017 publication writer; keep publication maintenance active and
forward-fix.

1. Confirm `wrangler.jsonc` still binds the web Worker custom domain
   `binance.v27.tech`, `vercel.json` keeps Git deployment disabled, and the
   legacy linked Vercel project is paused or removed in its dashboard.
2. Set `BETTER_AUTH_URL=https://binance.v27.tech` and verify Google OAuth has
   the exact callback `https://binance.v27.tech/api/auth/callback/google`.
3. Provision a stable web-only `ENROLLMENT_CODE_PEPPER` (at least 32
   characters) through Cloudflare Secrets. Never print it or rotate it while a
   shared code is live: changing it makes every existing code unusable. Capture
   the resulting old web Worker version as the pre-launch rollback target.
4. Provision the same `AI_CREDENTIAL_KEYRING` and
   `AI_CREDENTIAL_ACTIVE_KEY_ID` bindings to the web and Workflow Workers. Keep
   `GEMINI_TEXT_MODEL` and `GEMINI_IMAGE_MODEL` identical on both Workers.

### 0016-only enrollment cutover

Steps 5–10 are the historical 0016 enrollment procedure. Execute them only from
the exact release checkout whose migration journal ends at `0016`; they are not
the 0017 deployment procedure.

5. Back up the production database, rehearse `0016_shared_enrollment` on a
   production-like restored branch, and verify migration history ends at
   `0015` before the production cutover. Confirm an active owner exists, no
   unexpected `UserStatus` dependents exist, and at least three capacity units
   are free for the two shared-code smoke users plus one valid, unexpired legacy
   invitation issued before migration and retained only in the secret manager.
6. Verify an active owner session and permanent Cloudflare rate rules:
   `/api/enrollment/claim` and `/api/invitations/accept` at 10 requests/10
   minutes, and
   `/api/auth/callback/google` at 20 requests/10 minutes. During the short
   maintenance window, restrict `/join*`, `/api/enrollment/claim`,
   `/api/enrollment/complete`, `/api/invitations/accept`,
   `/api/auth/sign-in/social`, and `/api/auth/callback/google` to operator/tester
   IPs.
   Confirm the restriction is active and do not exercise an allowed signup route
   before migration.
7. Unset the rehearsal URL and close that shell. In a fresh operator shell, load
   the production `MIGRATION_DATABASE_URL`; fail closed unless its host+port,
   database, and role match the privately approved production identifiers and
   the connected database/role identity using `npm run db:target-check`. Permit
   exactly one `sslmode=require` query parameter and optionally exactly one
   `channel_binding=require`; reject every other query parameter.
   Through that exact connection, rerun the ledger, dependency, capacity,
   ownership, and immediate long-transaction/lock preflight. Then run
   `npm run --silent db:cutover-baseline` exactly once and copy its sole JSON
   output directly into the secret manager as the immutable
   `PRODUCTION_ROLLBACK_BASELINE`; never use ordinary `npm run`, command
   substitution/history, or a later recapture. Freeze direct database writes and
   immediately run only `npm run db:migrate:deploy` through the runbook's guarded
   status/cleanup block; require its original exit status and guaranteed removal
   of the connection and expected-identity variables.
   Do not run manual SQL or `db push`. Validate `UserStatus` now includes
   `pending` with a `pending` default and the enrollment tables/indexes exist.
8. Deploy the article Workflow Worker and then the web Worker at 100% from the
   same commit. Do not canary the web Worker: old and new enrollment flows cannot
   safely run together. Require the Workflow deploy and fresh web build to exit
   zero before the web deploy; a failed build must never fall through to a stale
   `.open-next` artifact. Pass the privately selected `CLOUDFLARE_ACCOUNT_ID`
   inline to every Wrangler command so an unexported shell variable cannot fall
   back to another authenticated account. Keep the temporary restriction until
   basic smoke passes.
9. Verify health and routes: `/api/health` is `200`; `/join`, `/join/complete`,
   and `/auth/error?error=signup_disabled&flow=enrollment` load;
   enrollment/admin APIs no longer return `404`. Create a code and use two
   disposable verified Google identities to prove code reuse and separate
   workspaces. Rotate a code to
   invalidate its old code and claim. Create another pending claim, disable the
   replacement without rotation, prove its code/claim fail and zero active codes
   remain, then create a final undistributed code.
10. Smoke the pre-cutover legacy invitation with a disposable identity. Suspend,
    restore, and revoke smoke users; verify sessions/devices/claims invalidate
    and capacity is released. Remove the temporary restriction, retain rate
    limits, monitor for 30 minutes, and only then distribute the retained
    `#code=` link privately through the approved secret-sharing channel.

### Post-deployment verification

For an 0017 cutover, reach these checks only after the dedicated 0017 runbook's
migration, 100% web deployment, and no-rollback boundary have completed.

11. Confirm `https://binance.v27.tech/api/health` returns `200` without exposing
   dependency details and that no Vercel deployment is serving the production
   hostname.
   Then smoke the Workflow Worker without writing data or spending tokens:
   `wrangler workflows trigger binance-article-jobs '{"jobId":"smoke-nonexistent","kind":"generate"}'`
   and `wrangler workflows instances describe binance-article-jobs <instance-id>`
   must show an errored instance with `NonRetryableError: Job payload not
   found.` and a successful `finalize failed article job` step — proving the
   worker boots, reaches the database, and fails closed.
12. Confirm stale non-English browser preferences still render the English UI.
13. While the temporary credential-mutation restriction remains active, use a
   pre-approved operator/tester source to save and test a disposable Gemini key.
   Confirm the default remains Platform credits, then explicitly switch to
   **Your Gemini key**. Generate a disposable article and confirm prompt
   generation, slide images, the dedicated cover, and retries complete with the
   selected source. Switch back to Platform credits, delete the copy, and
   confirm generation remains on Platform. Confirm a harmless credential
   mutation from a non-allowlisted source is still denied, then revoke the
   disposable key at Google separately.
14. Verify account settings navigation at the target responsive breakpoints:
   collapse the desktop rail and confirm the signed-in account control stays
   pinned at its bottom and opens its menu beside the rail; then open
   **Account settings** and confirm **AI & generation**, **Publishing**, and the
   administrator-only **People & access** sections load independently. Require
   no horizontal overflow on mobile and the settings rail on desktop. Start an
   enrollment-code request and a pairing-code request, then prove close and
   Browser Back cannot discard an unresolved or newly returned one-time value;
   confirm **Review code** and **Discard and close** work after it is shown.
15. Pair one disposable protocol-v2 browser device and verify it appears as
   active under **Account settings → Publishing** with protocol version 2.
16. With explicit operator authorization, smoke all four independent modes:
   text-only Binance Post, text-only X Post, coverless/media-free Binance
   Article, and coverless/media-free X Article. Then add optional media within
   each platform limit. Review and approve every exact live composer separately.
17. Confirm kind-matching canonical result URLs—including
   `https://x.com/i/article/<numeric-id>` for X Articles—and inspect the
   command/audit records.
18. Revoke the disposable device and confirm its token can no longer poll.

If Telegram was ever deployed, drain its jobs, remove its webhook and Workers,
delete its secrets, and revoke unused OAuth credentials after retention
requirements are satisfied. Historical Telegram migration files remain in the
repository for database compatibility and should not be rewritten.

Do not perform the smoke post from CI and do not seed social credentials into
repository secrets. The companion must use disposable, companion-managed,
locally authenticated Chrome publishing profiles controlled by the operator.

## Rollback

First determine the applied migration ledger.

If `0017` has committed, do not use the 0016 rollback gate to authorize a
captured pre-cutover web Worker. Apply an all-user maintenance deny, pause every
companion, drain publication commands to terminal states, and forward-fix. A
pre-0017 writer remains schema-incompatible even when no command is currently
`publishing`. Restoring a pre-0017 database backup is disaster recovery—not an
application rollback—and requires a full write freeze plus explicit data-loss
approval. An uncertain post-click result must remain `outcome_unknown` and must
never be retried automatically.

Only when the ledger ends at `0016` and `0017` has never committed may the 0016
rollback procedure be used. Follow the
[0016 cutover runbook](./docs/cutover-0016-runbook.md), including its all-user
maintenance deny, target checks, double-sample drain gate, cleanup traps, and
enrollment-data eligibility checks. Leave the database forward. Once any
enrollment code, claim, or user created since the cutover baseline exists, do
not restore the old Worker: keep enrollment disabled and forward-fix. A database
restore remains a last resort and requires explicit data-loss approval.
