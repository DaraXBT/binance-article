# Web-only release checklist

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

1. Provision the same `AI_CREDENTIAL_KEYRING` and
   `AI_CREDENTIAL_ACTIVE_KEY_ID` bindings to the web and Workflow Workers. Keep
   `GEMINI_TEXT_MODEL` and `GEMINI_IMAGE_MODEL` identical on both Workers.
2. Back up the staging database and apply migrations `0008`–`0015` on a
   production-like PostgreSQL/Neon branch.
3. Verify restore, lock duration, the one-time V1 draft backfill, and
   active-command drain. Do not resume a V1 writer after the backfill.
4. Deploy the article Workflow Worker, then the web Worker, from the same commit.
5. Confirm `GET /api/health` returns `200` without exposing dependency details.
   Then smoke the Workflow Worker without writing data or spending tokens:
   `wrangler workflows trigger binance-article-jobs '{"jobId":"smoke-nonexistent","kind":"generate"}'`
   and `wrangler workflows instances describe binance-article-jobs <instance-id>`
   must show an errored instance with `NonRetryableError: Job payload not
   found.` and a successful `finalize failed article job` step — proving the
   worker boots, reaches the database, and fails closed.
6. Confirm stale non-English browser preferences still render the English UI.
7. As a workspace owner, save and test a disposable Gemini key, confirm the
   default remains Platform credits, then explicitly switch to Workspace Gemini
   key. Generate a disposable article and confirm prompt generation, slide
   images, the dedicated cover, and retries complete with the selected source.
   Switch back to Platform credits, delete the copy, and confirm generation
   remains on Platform; revoke the disposable key at Google separately.
8. Pair one disposable browser device and verify it appears as active under
   **Settings → Connections**.
9. With explicit operator authorization, prepare and publish one controlled
   Binance smoke post and one controlled X smoke post. Review and approve each
   exact live composer separately.
10. Confirm canonical result URLs and inspect the command/audit records.
11. Revoke the disposable device and confirm its token can no longer poll.

If Telegram was ever deployed, drain its jobs, remove its webhook and Workers,
delete its secrets, and revoke unused OAuth credentials after retention
requirements are satisfied. Historical Telegram migration files remain in the
repository for database compatibility and should not be rewritten.

Do not perform the smoke post from CI and do not seed social credentials into
repository secrets. The companion must use disposable, companion-managed,
locally authenticated Chrome publishing profiles controlled by the operator.

## Rollback

Keep the previous web/Workflow/companion artifacts available. Stop new
publication preparation, drain active commands, and roll back only after no
command is in `publishing`; an uncertain post-click result must remain
`outcome_unknown` and must never be retried automatically.
