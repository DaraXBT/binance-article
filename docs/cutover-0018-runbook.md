# Gemini credential constraint repair (migration 0018)

Migration `0018_soft_unicorn` replaces only the deployed
`WorkspaceAiCredential_ciphertext_base64url_check`. PostgreSQL rejects the
`{24,2048}` regular-expression bound used by migration `0015` when the check is
evaluated. The corrected constraint separates the character predicate from the
length predicate:

```sql
"ciphertext" ~ '^[A-Za-z0-9_-]+$'
AND char_length("ciphertext") BETWEEN 24 AND 2048
```

The independent base64url modulo check remains unchanged. The repair bounds
lock acquisition to five seconds and total statement execution to two minutes,
so an unexpected reader fails the transaction instead of queueing production
traffic indefinitely. Never edit or re-stamp applied migration `0015`.

## Preconditions

- Set `FINAL_CHECKOUT` to the absolute path of a clean checkout of the exact
  CI-green final release SHA. It must contain the new `db:cutover-check`, 0018,
  and the Worker source to deploy. Require the release-tree, test, typecheck,
  lint, build, Cloudflare dry-run, and Drizzle checks to pass for that exact
  SHA. If this follows 0017, switch back from `MIGRATION_0017_CHECKOUT` before
  doing anything in this runbook; the historical 0017-only checkout does not
  contain the verifier or 0018.
- Confirm the production migration ledger ends at exactly `0017` and the live
  schema matches the `0017` snapshot. Explicitly confirm no ledger row exists
  for `0018`'s journal timestamp (`1786878159785`), its superseded hash
  (`fbffebbaab6702061625a4c6274b8d16e676f677a582fc8fb931a2b53a13826a`),
  or its final hash
  (`926a7de82961250a9b358437e596bed4585af222558ce2bfe639dbba172701b8`).
  Drizzle skips an already-stamped timestamp even when the SQL file later
  changes. Abort on any other state or drift and inspect the live constraint
  before deciding on a separate repair.
- Take and verify a restorable production snapshot. Use the guarded production
  migration-role connection. The staged `db:cutover-check` commands below must
  positively verify its authority, database, role, ledger, schema, privileges,
  transaction state, and locks; do not substitute a manual catalog query.
- When 0018 immediately follows 0017, retain
  `CUTOVER_MAINTENANCE_MODE=full` with
  `CUTOVER_MAINTENANCE_ALLOW_IPS` absent. Do not deploy an intermediate Worker,
  add a tester, or reopen any traffic between migrations. A chained cutover
  arrives here only after the final-checkout
  `post-0017-pre-0018` verifier passed.
- For a standalone 0018 cutover, pause every companion and run the staged
  verifier before gate bootstrap. If any publication command is nonterminal,
  stop: this release has no safe route-scoped drain mode, and an IP allowlist
  cannot substitute for one. A future nonempty cutover requires a separate
  phase-one implementation that denies new publication work while allowing only
  completion calls. With every command terminal, activate the full-site gate
  with no allowlist and positively prove both HTML and API return `503`. Use the
  authenticated Wrangler OAuth profile rather than a copied API token:
  ```bash
  unset CLOUDFLARE_API_TOKEN
  test -n "${FINAL_CHECKOUT:-}" || exit 1
  test -d "$FINAL_CHECKOUT" || exit 1
  test -n "${CLOUDFLARE_ACCOUNT_ID:-}" || exit 1
  (
    cd "$FINAL_CHECKOUT" || exit 1
    npx wrangler whoami || exit $?
    CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
      npx wrangler secret list --config wrangler.jsonc --format pretty || exit $?
    npm run db:cutover-check -- post-0017-pre-0018 || exit $?
  ) || exit $?
  ```
  If `CUTOVER_MAINTENANCE_ALLOW_IPS` is listed, delete it and re-list. If
  `CUTOVER_MAINTENANCE_MODE` is listed as a secret, do **not** delete it: its
  value is unreadable and it may be the active fail-closed gate. The atomic
  deploy below replaces that binding. Then build the final web bundle fresh and
  deploy the gate-capable bundle with the existing model vars and full mode:
  ```bash
  (
    cd "$FINAL_CHECKOUT" || exit 1
    CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
      npx wrangler secret delete CUTOVER_MAINTENANCE_ALLOW_IPS \
        --config wrangler.jsonc || exit $?
    CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
      npx wrangler secret list --config wrangler.jsonc --format pretty || exit $?
    npm run cloudflare:build || exit $?
    CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
      npx wrangler deploy --config wrangler.jsonc \
        --var 'GEMINI_TEXT_MODEL:gemini-2.5-flash' \
        --var 'GEMINI_IMAGE_MODEL:gemini-3.1-flash-image-preview' \
        --var 'CUTOVER_MAINTENANCE_MODE:full' || exit $?
    CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
      npx wrangler secret list --config wrangler.jsonc --format pretty || exit $?
  ) || exit $?
  test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    'https://binance.v27.tech/')" = '503' || exit 1
  test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --header 'Accept: application/json' \
    'https://binance.v27.tech/api/health')" = '503' || exit 1
  ```
  Omit the allowlist delete block only when that name was absent—not the initial
  listing, fresh build, atomic deploy, post-deploy listing, or two `503` checks.
  Require the post-deploy list to omit both maintenance secret names; mode is
  now a plain deployment var. Repeated `--var` flags were dry-run verified with
  Wrangler 4.114; do not use `--keep-vars`. This is a gate bootstrap only when
  the previously live Worker lacks the gate. If build, deploy, or either `503`
  check fails, do not migrate.
- Full maintenance also blocks `/api/workspace/ai-credential`; no credential
  mutation exception is present before or during migration. Fix one tester
  egress IP, tester user, and disposable Gemini key before the window, but add
  only the IP after both new Workers are live. Do not add or widen identities
  during cutover.

## Apply and verify

1. In the dedicated operator shell, securely load `MIGRATION_DATABASE_URL` and
   the three approved non-secret target identifiers required by
   `db:cutover-check`. With full maintenance active and no allowlist, run all
   three commands from the final checkout:
   ```bash
   (
     cd "$FINAL_CHECKOUT" || exit 1
     npm run db:cutover-check -- post-0017-pre-0018 || exit $?
     npm run db:migrate:deploy || exit $?
     npm run db:cutover-check -- post-0018 || exit $?
   ) || exit $?
   ```
   The pre-check must pass before migration. The post-check must prove the exact
   final 0018 ledger/hash, character-only plus `BETWEEN 24 AND 2048` constraint,
   retained modulo constraint, zero violating credential rows, correct
   ownership/privileges, zero nonterminal publisher commands, and clear
   transaction/lock state. Do not use `db push`, manual SQL, or a modified copy
   of migration `0015`. A timeout or other failure is transactional; keep every
   applicable restriction active and require `post-0017-pre-0018` to pass again
   before retrying.
2. Deploy the Workflow Worker first, then perform a fresh web build and deploy
   the web Worker from the same exact final SHA. This exact block applies both
   to a chained 0017→0018 cutover and to a standalone 0018 cutover:
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
   Do not reuse an earlier `.open-next` artifact if the fresh build fails.
   Immediately repeat the external HTML and API `503` checks; the maintenance
   mode must remain active and the allowlist must remain absent across deploy.
3. Add only the fixed tester IP, without printing its value, after the final web
   deployment and its `503` verification:
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
   Run that final curl from the exact tester IP. From an independent source,
   require HTML and API to remain `503`. The browser and approved V3 companion
   used for publication smoke must share the fixed tester egress.
4. If this window began with 0017, run all publication checks in the 0017
   runbook through that tester path. Keep full maintenance active for every
   other source until they pass.
5. Smoke Account settings at the target mobile and desktop viewports. From the
   fixed tester path, use a disposable Gemini key
   to save, test, switch sources, switch back to Platform credits, and delete
   the stored copy. Confirm the same mutation remains denied from a
   non-allowlisted source during the smoke. Revoke the disposable key at Google
   separately.
6. Only after every applicable smoke passes, delete the tester allowlist while
   the deployed `full` var remains active, returning to a fail-closed state.
   Then deploy the same already-built final web bundle from standard
   `wrangler.jsonc` without cutover `--var` flags. With no `--keep-vars`, this
   atomically removes the temporary mode and opens traffic:
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
   from the former tester IP before the standard deployment. If any smoke
   fails, do not run this removal sequence; keep maintenance active and
   forward-fix.

## Failure and rollback

Before `0018` commits, leave full maintenance active with no allowlist and fix
forward. After `0018` commits, do not restore the invalid `{24,2048}`
constraint: the repair matches the original data contract and is compatible
with older application readers. Application rollback eligibility is governed
by the already-applied `0017` publication cutover boundary; never restore a
pre-`0017` writer. A failed deploy or smoke is not authority to set maintenance
off.
