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
MIGRATION_DATABASE_URL='postgresql://...' npm run db:check
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
5. Back up the production database, rehearse `0016_shared_enrollment` on a
   production-like restored branch, and verify migration history ends at
   `0015` before the production cutover. Confirm an active owner exists, no
   unexpected `UserStatus` dependents exist, and at least three capacity units
   are free for the two shared-code smoke users plus one legacy invitation.
6. Verify permanent Cloudflare rate rules: `/api/enrollment/claim` and
   `/api/invitations/accept` at 10 requests/10 minutes, and
   `/api/auth/callback/google` at 20 requests/10 minutes. During the short
   maintenance window, restrict `/join*`, enrollment and invitation acceptance,
   and Google enrollment endpoints to operator/tester IPs.
7. Apply only `MIGRATION_DATABASE_URL='postgresql://...' npm run db:migrate:deploy`.
   Do not run manual SQL or `db push`. Validate `UserStatus` now includes
   `pending` with a `pending` default and the enrollment tables/indexes exist.
8. Deploy the article Workflow Worker and then the web Worker at 100% from the
   same commit. Do not canary the web Worker: old and new enrollment flows cannot
   safely run together. Keep the temporary restriction until basic smoke passes.
9. Verify health and routes: `/api/health` is `200`; `/join`, `/join/complete`,
   and the friendly `signup_disabled?` error page load; enrollment/admin APIs no
   longer return `404`. Create a code and use two disposable verified Google
   identities to prove code reuse and separate workspaces. Rotate a code to
   invalidate its old code and claim, then retain a final undistributed code.
10. Smoke one valid legacy invitation with a disposable identity. Suspend,
    restore, and revoke smoke users; verify sessions/devices/claims invalidate
    and capacity is released. Remove the temporary restriction, retain rate
    limits, and monitor for 30 minutes.
11. Verify restore, lock duration, the one-time V1 draft backfill, and
   active-command drain. Do not resume a V1 writer after the backfill.
12. Confirm `https://binance.v27.tech/api/health` returns `200` without exposing
   dependency details and that no Vercel deployment is serving the production
   hostname.
   Then smoke the Workflow Worker without writing data or spending tokens:
   `wrangler workflows trigger binance-article-jobs '{"jobId":"smoke-nonexistent","kind":"generate"}'`
   and `wrangler workflows instances describe binance-article-jobs <instance-id>`
   must show an errored instance with `NonRetryableError: Job payload not
   found.` and a successful `finalize failed article job` step — proving the
   worker boots, reaches the database, and fails closed.
13. Confirm stale non-English browser preferences still render the English UI.
14. As a workspace owner, save and test a disposable Gemini key, confirm the
   default remains Platform credits, then explicitly switch to Workspace Gemini
   key. Generate a disposable article and confirm prompt generation, slide
   images, the dedicated cover, and retries complete with the selected source.
   Switch back to Platform credits, delete the copy, and confirm generation
   remains on Platform; revoke the disposable key at Google separately.
15. Verify workspace settings navigation at the target responsive breakpoints:
   collapse the desktop rail and confirm the signed-in account control stays
   pinned at its bottom and opens its menu beside the rail; then open
   **Settings** and confirm the Connections panel has no horizontal overflow on
   mobile and shows its settings rail on desktop.
16. Pair one disposable browser device and verify it appears as active under
   **Settings → Connections**.
17. With explicit operator authorization, prepare and publish one controlled
   Binance smoke post and one controlled X smoke post. Review and approve each
   exact live composer separately.
18. Confirm canonical result URLs and inspect the command/audit records.
19. Revoke the disposable device and confirm its token can no longer poll.

If Telegram was ever deployed, drain its jobs, remove its webhook and Workers,
delete its secrets, and revoke unused OAuth credentials after retention
requirements are satisfied. Historical Telegram migration files remain in the
repository for database compatibility and should not be rewritten.

Do not perform the smoke post from CI and do not seed social credentials into
repository secrets. The companion must use disposable, companion-managed,
locally authenticated Chrome publishing profiles controlled by the operator.

## Rollback

Keep the previous web/Workflow/companion artifacts available. Before any new
enrollment completes, re-enable the temporary restriction and roll back only
the web Worker to the captured post-pepper old version; leave the database
forward. After new enrollment exists, do not restore the old Worker: block
enrollment and forward-fix instead. A database restore is last resort and
requires explicit data-loss approval. Stop new publication preparation, drain
active commands, and roll back only after no command is in `publishing`; an
uncertain post-click result must remain `outcome_unknown` and must never be
retried automatically.
