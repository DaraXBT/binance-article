# Publication kind cutover runbook (migration 0017)

Migration 0017 is a contract cutover, not a rolling or zero-downtime migration.
It makes `kind` required and replaces the publication-draft conflict key
`(workspaceId, articleId, target)` with `(workspaceId, articleId, target, kind)`.
The old web release omits `kind` and still targets the old conflict key, so it
must not perform publication writes after 0017 commits.

## Before the window

- Prepare two separate, clean checkouts and record their absolute paths as
  `FINAL_CHECKOUT` and `MIGRATION_0017_CHECKOUT`. `FINAL_CHECKOUT` is the exact
  CI-green final release and contains `db:cutover-check`; use it for every
  read-only verifier, the 0018 migration, builds, and deployments.
  `MIGRATION_0017_CHECKOUT` is the approved historical SHA whose journal ends
  at `0017`; use it **only** for the 0017 `db:migrate:deploy`. That historical
  checkout does not contain the new verifier. Conversely, the final checkout
  contains `0018`, so running its migration command from the pre-0017 state
  would apply both pending migrations. Never copy the verifier or migration
  files between checkouts. Require `npm run release:tree-check`,
  `npm run db:check`, and the applicable full test/typecheck gates to pass in
  both checkouts before the window.
- Take and verify a restorable production backup or branch. Rehearse 0017 on a
  production-sized restore using the production migration role and record the
  duration. It must finish comfortably within the migration's transaction-local
  `lock_timeout = '5s'` and `statement_timeout = '2min'` limits.
- Confirm the production migration ledger ends at 0016 and the schema matches
  the 0016 snapshot. Abort on drift.
- Confirm the migration role is an effective `pg_read_all_stats` member so the
  verifier can see other sessions' transaction ages. It must also own
  `PublicationDraft`, `PublisherCommand`, and `WorkspaceAiCredential`; have
  `CREATE` on the database; have `USAGE, CREATE` on `public` and `drizzle`;
  have `SELECT, INSERT` on `drizzle.__drizzle_migrations`; and have `USAGE` on
  its ID sequence. The verifier intentionally fails closed if any capability
  is missing.
- Install the protocol-v2/V3-capable publisher companion, but keep every
  companion paused until the new web release is live and smoke-tested.
- Before the window, rehearse the fail-closed full-site maintenance gate on a
  non-production Worker. The current production Worker predates this gate, and
  the final app is schema-0017-dependent, so the first production web deploy
  must atomically install the gate and its `full` binding. Use the authenticated
  Wrangler OAuth profile, not a copied API token, and confirm the selected
  account and `binance-article-web` Worker before that bootstrap deploy.

## Publication-write maintenance

Use `CUTOVER_MAINTENANCE_MODE=full` to deny all dynamic web and API traffic.
Static framework assets may still be served, but they are not a successful
health signal. The gate returns `503`, `Cache-Control: no-store`, and
`Retry-After: 120` for blocked HTML and API requests. Any nonempty mode other
than the exact value `full` also fails closed.

Production currently has no publisher commands, so use the zero-command path:

1. In the dedicated operator shell, force Wrangler to use its authenticated
   OAuth profile, identify the final checkout and account, securely load the
   migration connection/expected identifiers, pause every companion, and run
   the pre-0017 verifier once before bootstrap:
   ```bash
   unset CLOUDFLARE_API_TOKEN
   test -n "${FINAL_CHECKOUT:-}" || exit 1
   test -d "$FINAL_CHECKOUT" || exit 1
   test -n "${MIGRATION_0017_CHECKOUT:-}" || exit 1
   test -d "$MIGRATION_0017_CHECKOUT" || exit 1
   test -n "${CLOUDFLARE_ACCOUNT_ID:-}" || exit 1
   (
     cd "$FINAL_CHECKOUT" || exit 1
     npx wrangler whoami || exit $?
     CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
       npx wrangler secret list --config wrangler.jsonc --format pretty || exit $?
     npm run db:cutover-check -- pre-0017 || exit $?
   ) || exit $?
   ```
   Secret listing prints names, not values. The verifier must confirm every
   command is terminal before bootstrap. If it fails or private read-only
   diagnostics find a nonterminal command, stop: this release has no safe
   route-scoped drain mode. A future nonempty cutover requires a separately
   implemented and verified phase-one rule that denies save, prepare, approve,
   cancel, and claim while allowing only existing begin/editor-ready/result/abort
   completion; an IP allowlist is not a route restriction.

   If `CUTOVER_MAINTENANCE_ALLOW_IPS` is listed, remove it and re-list. If
   `CUTOVER_MAINTENANCE_MODE` is listed as a secret, do **not** delete it: secret
   values are unreadable, so deletion could disable an active fail-closed gate.
   The atomic CLI-var deployment in step 2 replaces that binding safely.
   ```bash
   (
     cd "$FINAL_CHECKOUT" || exit 1
     CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
       npx wrangler secret delete CUTOVER_MAINTENANCE_ALLOW_IPS \
         --config wrangler.jsonc || exit $?
     CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
       npx wrangler secret list --config wrangler.jsonc --format pretty || exit $?
   ) || exit $?
   ```
   Omit that delete block only when the allowlist name was absent, and require
   the post-cleanup list to omit `CUTOVER_MAINTENANCE_ALLOW_IPS`.
2. Build the final web bundle fresh. Then atomically deploy the gate-capable
   bundle with the existing model vars and `CUTOVER_MAINTENANCE_MODE=full` in
   the same Worker version:
   ```bash
   (
     cd "$FINAL_CHECKOUT" || exit 1
     npm run cloudflare:build || exit $?
     CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
       npx wrangler deploy --config wrangler.jsonc \
         --var 'GEMINI_TEXT_MODEL:gemini-2.5-flash' \
         --var 'GEMINI_IMAGE_MODEL:gemini-3.1-flash-image-preview' \
         --var 'CUTOVER_MAINTENANCE_MODE:full' || exit $?
     CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
       npx wrangler secret list --config wrangler.jsonc --format pretty || exit $?
   ) || exit $?
   ```
   Wrangler 4.114 dry-run verification confirms repeated `--var` flags merge
   into one deployment; spelling out both model vars prevents the safety
   override from dropping them. Do not add `--keep-vars`. This first web deploy
   is a **gate bootstrap only**, not the application cutover: the final app must
   not receive a dynamic request while production is still at 0016. If the
   build or deploy fails, do not migrate. The final web SHA will be rebuilt and
   redeployed after Workflow and database cutover. Require the post-deploy
   secret list to omit both maintenance names; mode is now a plain deployment
   var, not a secret.
3. From an external, non-allowlisted network, positively prove that both HTML
   and API traffic receive `503`; a cached page, static asset, redirect, `401`,
   or application validation response does not pass:
   ```bash
   test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
     'https://binance.v27.tech/')" = '503' || exit 1
   test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
     --header 'Accept: application/json' \
     'https://binance.v27.tech/api/health')" = '503' || exit 1
   ```
   Keep the allowlist absent through both migrations and their post-checks.

### Publication smoke allowlist

Before the window, record one exact tester egress IP, test workspace, tester
user, controlled X and Binance accounts, and companion device in the private
change ticket. After deployment, `CUTOVER_MAINTENANCE_ALLOW_IPS` contains only
that one IP; the browser and companion must share that egress. Application auth
still limits the user, workspace, accounts, and device. This is not a wildcard
operator bypass and must not be widened during the window. If the fixed tester
path cannot complete smoke, keep maintenance active and forward-fix. Do not put
account credentials, session material, tokens, or the allowlist value in Git or
command output.

## Cutover order

1. With the full gate active and no allowlist, securely load
   `MIGRATION_DATABASE_URL` and the three approved non-secret target identifiers
   required by `db:cutover-check`. Run both read-only checks from
   `FINAL_CHECKOUT`, but run the first migration command only from
   `MIGRATION_0017_CHECKOUT`:
   ```bash
   (
     cd "$FINAL_CHECKOUT" || exit 1
     npm run db:cutover-check -- pre-0017 || exit $?
   ) || exit $?
   (
     cd "$MIGRATION_0017_CHECKOUT" || exit 1
     npm run db:migrate:deploy || exit $?
   ) || exit $?
   (
     cd "$FINAL_CHECKOUT" || exit 1
     npm run db:cutover-check -- post-0017-pre-0018 || exit $?
   ) || exit $?
   ```
   The first command fail-closes on connected database/role drift, the exact
   pre-0017 ledger, nonterminal publisher commands, ownership/privilege drift,
   unexpected long transactions, waiting locks, or schema drift. Do not run the
   migration if it fails. The post command is mandatory before changing
   checkout or deploying; it verifies the exact 0017 ledger/hash and complete
   publication schema contract. A migration timeout or other failure is
   transactional; keep maintenance active and require `pre-0017` to pass again
   before any retry. Never use `db push` or manual schema SQL.
2. If 0018 is part of this release, keep full maintenance active with **no**
   allowlist. Only after `post-0017-pre-0018` passes, follow the 0018 runbook
   from `FINAL_CHECKOUT`. Do not deploy an intermediate 0017 Worker or reopen
   traffic between migrations.
3. After every required forward migration passes its post-state verifier,
   deploy the Workflow Worker first and then a freshly built web Worker at 100%
   from the same final SHA. For a standalone 0017 cutover, run exactly:
   ```bash
   (
     cd "$FINAL_CHECKOUT" || exit 1
     test -n "${CLOUDFLARE_ACCOUNT_ID:-}" || exit 1
     CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
       npx wrangler deploy --config wrangler.workflow.jsonc || exit $?

     npm run cloudflare:build || exit $?
     CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
       npx wrangler deploy --config wrangler.jsonc \
         --var 'GEMINI_TEXT_MODEL:gemini-2.5-flash' \
         --var 'GEMINI_IMAGE_MODEL:gemini-3.1-flash-image-preview' \
         --var 'CUTOVER_MAINTENANCE_MODE:full' || exit $?
   ) || exit $?
   ```
   Do not canary, let an old Worker share the migrated database, or reuse an old
   `.open-next` artifact after a failed build. Immediately repeat both external
   `503` checks; the full mode var must survive deployment and the allowlist
   must remain absent.
4. Only after the final web Worker is live and still returns `503`, add the one
   fixed tester IP without printing it:
   ```bash
   test -n "${CUTOVER_TESTER_IP:-}" || exit 1
   CUTOVER_TESTER_IP="$CUTOVER_TESTER_IP" \
     node -e "process.exit(/^[0-9A-Fa-f:.]{2,45}$/.test(process.env.CUTOVER_TESTER_IP ?? '') ? 0 : 1)" \
     || exit 1
   (
     cd "$FINAL_CHECKOUT" || exit 1
     printf '%s' "$CUTOVER_TESTER_IP" | \
       CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
       npx wrangler secret put CUTOVER_MAINTENANCE_ALLOW_IPS \
         --config wrangler.jsonc || exit $?
   ) || exit $?
   test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
     'https://binance.v27.tech/api/health')" = '200' || exit 1
   ```
   Run that final curl from the exact tester IP. An independent source must still
   receive `503` for both HTML and API. Start only the approved protocol-v2/V3
   companion through the same egress, then perform the smoke checks below.
5. Lift maintenance only after every smoke passes. First delete the tester
   allowlist while the deployed `full` var remains active; this deliberately
   returns the site to a fail-closed, no-exception state. Then deploy the same
   already-built final web bundle from standard `wrangler.jsonc` with no
   cutover `--var`. Because `--keep-vars` is not used, that deployment removes
   the temporary mode var and opens traffic atomically:
   ```bash
   (
     cd "$FINAL_CHECKOUT" || exit 1
     CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
       npx wrangler secret delete CUTOVER_MAINTENANCE_ALLOW_IPS \
         --config wrangler.jsonc || exit $?
     CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
       npx wrangler secret list --config wrangler.jsonc --format pretty || exit $?
   ) || exit $?
   test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
     'https://binance.v27.tech/')" = '503' || exit 1
   test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
     --header 'Accept: application/json' \
     'https://binance.v27.tech/api/health')" = '503' || exit 1
   (
     cd "$FINAL_CHECKOUT" || exit 1
     CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
       npx wrangler deploy --config wrangler.jsonc || exit $?
   ) || exit $?
   test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
     'https://binance.v27.tech/api/health')" = '200' || exit 1
   unset CUTOVER_TESTER_IP
   ```
   Require the secret list to omit the allowlist, then run both `503` checks
   from the former tester IP before the standard deployment. Monitor web and
   companion errors, command latency, and failed/outcome-unknown commands. If
   any smoke fails, do not run the allowlist deletion or standard deployment;
   keep the gate active and forward-fix.

## Smoke checks

Using an approved test workspace and controlled publisher accounts, verify:

- existing V2 X-post and Binance-article drafts still load with unchanged
  recipe hashes;
- X Post and Binance Post each save and prepare text-only content, and optionally
  accept up to four images;
- X Article and Binance Article each require title/body, while cover and body
  images remain optional;
- Post and Article drafts for the same article and target remain independent;
- each prepared command records the requested `target` and `kind`, still waits
  for explicit web approval, is claimed by the V3 companion, and finishes with
  a canonical URL whose path matches that kind;
- empty posts and incomplete articles are rejected.

If external publication is not permitted during the window, exercise the full
prepare/review/approval path and stop before the external publish action; keep
maintenance in place until an authorized end-to-end publish can be verified.

## Rollback boundary

- **Before 0017 commits:** leave the gate-bootstrap web version active with full
  maintenance and no allowlist. A migration failure is transactional; verify
  the ledger/schema still end at 0016, correct the cause, and retry while all
  dynamic traffic remains blocked.
- **After 0017 commits:** the old web release is no longer a safe writer, even
  before the first V3 draft. Do not remove `kind`, recreate the old conflict
  index, or redeploy the old web release with ad-hoc SQL.
- **After any V3 or second-kind write:** the data model has crossed an irreversible
  compatibility boundary. Keep publication maintenance active and forward-fix.
  Restoring the pre-cutover backup is a disaster-recovery action requiring a
  full write freeze and explicit acceptance/reconciliation of all post-backup
  data loss; it is not an application rollback.
