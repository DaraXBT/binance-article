# Shared enrollment cutover runbook (migration 0016)

This is the operator script for the one window that ships shared enrollment. It
supplements `RELEASE_CHECKLIST.md`. Keep non-secret infrastructure identifiers,
such as account IDs, database project IDs, deployment version IDs, IP allowlists,
and scratch paths, in the private operator shell or an access-controlled change
ticket—not in this repository. Secret values and secret-bearing connection
strings, including database URLs, enrollment codes/links, claim or invitation
tokens, OAuth credentials, and disposable identity details, belong only in the
secret manager or operator process, never in Git, logs, or tickets.

## Required state at the start of the window

| Fact | Requirement |
| --- | --- |
| Release commit | Clean checkout of the exact CI-green remote SHA |
| Current live web version | Captured privately in `WEB_ROLLBACK_VERSION` immediately before migration |
| Live DB migration state | Ends at `0015` (16 applied migrations, `0000`–`0015`) |
| Migration to apply | `0016_shared_enrollment` (journal idx 16, the 17th) |
| Secrets | Web Worker has all required bindings, including stable `ENROLLMENT_CODE_PEPPER`; Workflow has all required bindings |
| Cloudflare account | Selected privately through `CLOUDFLARE_ACCOUNT_ID` |
| Legacy compatibility | One valid, unexpired invitation issued before migration is retained only in the secret manager/operator process for the smoke test |
| Migration target | Approved production host+port authority, database name, and migration-role identifiers are loaded privately for a fail-closed target comparison |
| Rollback baseline | One immutable JSON timestamp/count pair is captured once, through the target-verified connection, after pre-flight and immediately before migration |
| Rollback drain | Production edge/security-event and Worker-observability access are confirmed; automated health probes can be paused during the command's fixed 300-second double-sample interval |
| Release checkout | Fresh `mktemp -d` clone with no local/secret-bearing env files; tracked `.env.example` is allowed and both Worker dry-runs pass |

Before the window, record the live status of `/api/health`, `/join`,
`/join/complete`, and `/api/enrollment/claim` in the private change ticket. After
deployment, the new pages and API must no longer return the old-release `404`.

## What prep proved about 0016

- **Existing status values are preserved, but the table is rewritten.** The
  cross-enum cast physically rewrites `public.user` and its status indexes while
  holding `ACCESS EXCLUSIVE`; it is not an in-place metadata change. Migration
  0016 therefore starts with transaction-local `lock_timeout = '5s'` and
  `statement_timeout = '2min'`. A local rehearsal seeded at `0015` confirmed
  `active`/`suspended`/`revoked` all survived, and only a newly inserted row
  picked up `pending`. Production rehearsal must finish comfortably inside the
  two-minute bound; a timeout rolls the transaction back to `0015`.
- **Existing values are cast-compatible.** The old enum
  `('active','suspended','revoked')` is a strict subset of the new one. Production
  must still pass the dependency, permission, and lock preflight.
- **Existing authenticated sessions remain schema-compatible.** The enrollment
  gate is wired only to Better Auth's `user.create.before` hook
  (`server/auth/better-auth.ts:70-74`), so it never runs for an existing account.
  `authorizeRequest` still requires `status === 'active'`, which legacy users
  keep. New Google sign-ins are intentionally restricted during maintenance.
- **Not idempotent, but fully transactional.** No `CONCURRENTLY`, no
  `IF NOT EXISTS`. A failure rolls back whole and leaves you cleanly at `0015`;
  a retry from there is safe. Re-running after success fails — that is expected,
  not damage.

## Pre-flight (read-only, run against production before the window)

```sql
-- 1. Migration ledger must end at 0015. Expect applied = 16, and the newest
--    created_at must equal 0015's journal timestamp (1785038536842).
SELECT count(*) AS applied, max(created_at) AS newest
FROM drizzle.__drizzle_migrations;

-- 2. At least one active owner must exist, or you cannot mint a code afterwards.
SELECT count(*) AS active_owners FROM "user" WHERE role = 'owner' AND status = 'active';

-- 3a. Exactly one row expected: public.user.status. Selecting the relation
--     namespace prevents a same-named table in another schema from hiding drift.
SELECT relation_ns.nspname AS table_schema,
       c.relname AS table_name,
       a.attname AS column_name
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace relation_ns ON relation_ns.oid = c.relnamespace
JOIN pg_type  t ON t.oid = a.atttypid
JOIN pg_namespace type_ns ON type_ns.oid = t.typnamespace
WHERE type_ns.nspname = 'public' AND t.typname = 'UserStatus'
  AND NOT a.attisdropped AND c.relkind IN ('r','v','m');

-- 3b. Review every dependency on both the enum and its generated array type,
--     including defaults, domains, functions, and array-typed columns. Expect
--     only public.user.status, its current default, and the system-generated
--     UserStatus[] dependency. Anything else blocks migration.
WITH user_status_types AS (
  SELECT t.oid AS enum_oid, t.typarray AS array_oid
  FROM pg_type t
  JOIN pg_namespace type_ns ON type_ns.oid = t.typnamespace
  WHERE type_ns.nspname = 'public' AND t.typname = 'UserStatus'
)
SELECT format_type(d.refobjid, NULL) AS referenced_type,
       d.deptype,
       pg_describe_object(d.classid, d.objid, d.objsubid) AS dependent_object
FROM pg_depend d
CROSS JOIN user_status_types status_types
WHERE d.refclassid = 'pg_type'::regclass
  AND d.refobjid IN (status_types.enum_oid, status_types.array_oid)
ORDER BY dependent_object;

-- 4. Capacity. MAX_ACTIVE_ENROLLMENT_USERS = 10 and active users share the budget
--    with live legacy invitations. Need >= 3 free, so expect 7 or below.
--    Mirrors the capacity CTE in server/modules/enrollment/repository.ts:303-320:
--    an 'accepted' invitation still consumes a seat until it is bound to a user.
SELECT (SELECT count(*) FROM "user" WHERE status = 'active')
     + (SELECT count(*) FROM "Invitation"
        WHERE (status = 'pending'
               OR (status = 'accepted' AND "acceptedByUserId" IS NULL))
          AND "expiresAt" > now()) AS seats_used;

-- 5. Sanity: no pre-existing enrollment tables (0016 creates them).
SELECT to_regclass('public."EnrollmentCode"')  AS code_table,
       to_regclass('public."EnrollmentClaim"') AS claim_table;  -- both NULL

-- 6. The migration role must own the altered table/type and be able to create
--    objects in public. Run this with the exact migration-role connection.
SELECT current_user = pg_get_userbyid(c.relowner) AS owns_user_table,
       current_user = pg_get_userbyid(t.typowner) AS owns_user_status,
       has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage,
       has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create
FROM pg_class c
JOIN pg_namespace relation_ns ON relation_ns.oid = c.relnamespace
CROSS JOIN pg_type t
JOIN pg_namespace type_ns ON type_ns.oid = t.typnamespace
WHERE relation_ns.nspname = 'public' AND c.relname = 'user'
  AND type_ns.nspname = 'public' AND t.typname = 'UserStatus';

-- 7. Run immediately before migration. Expect no unapproved long-running
--    transaction and no waiting lock. Do not select query text into logs.
SELECT pid, usename, application_name, state,
       now() - xact_start AS transaction_age,
       wait_event_type, wait_event
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND xact_start IS NOT NULL
  AND now() - xact_start > interval '30 seconds';

SELECT locks.locktype, locks.mode, locks.granted, count(*) AS lock_count
FROM pg_locks locks
JOIN pg_stat_activity activity ON activity.pid = locks.pid
WHERE activity.datname = current_database()
  AND locks.pid <> pg_backend_pid()
  AND NOT locks.granted
GROUP BY locks.locktype, locks.mode, locks.granted;

SELECT locks.mode, locks.granted, count(*) AS lock_count
FROM pg_locks locks
JOIN pg_stat_activity activity ON activity.pid = locks.pid
WHERE activity.datname = current_database()
  AND locks.pid <> pg_backend_pid()
  AND locks.relation = 'public."user"'::regclass
GROUP BY locks.mode, locks.granted;
```

Abort the window if (1) is not 16, (2) is 0, (3) does not return exactly
`public.user.status` or shows an unexplained dependency, (4) exceeds 7, (5)
returns anything non-NULL, (6) contains any `false`, or (7) returns any row.
Any dependency row whose `referenced_type` is `public."UserStatus"[]` blocks the
migration; the only expected array-related row is the internally generated
array type depending on the base enum.
If a transient application lock appears on `public.user`, keep enrollment
restricted, wait for it to drain, and rerun the complete immediate lock check;
never wait behind it during migration.

## Cutover

1. **Back up.** Take a restorable Neon branch/snapshot and record its project and
   branch IDs in the private change ticket. Keep that pre-cutover recovery point
   untouched.
2. **Rehearse on a separate restore/fork.** Restore or fork the backup into a
   disposable rehearsal branch. Use the same migration-role grants as
   production, point `MIGRATION_DATABASE_URL` only at rehearsal, rerun the full
   pre-flight, apply `npm run db:migrate:deploy`, and record the duration. Confirm
   statuses survive, the rewrite completes comfortably inside the two-minute
   statement bound, and the untouched backup can still be restored. Then
   `unset MIGRATION_DATABASE_URL`, verify it is absent, and close that operator
   shell before touching production.
3. **Owner session + edge controls.** Confirm an active owner session before
   applying the restriction and confirm the pre-cutover legacy invitation is
   still valid and unexpired. Per `RELEASE_CHECKLIST.md` step 6:
   `/api/enrollment/claim` and `/api/invitations/accept` at 10 req/10 min,
   `/api/auth/callback/google` at 20 req/10 min. Apply the temporary operator/tester
   IP restriction to `/join*`, `/api/enrollment/claim`,
   `/api/enrollment/complete`, `/api/invitations/accept`,
   `/api/auth/sign-in/social`, and `/api/auth/callback/google`. Confirm it is
   active before migration. Do not exercise an allowed signup route or capture a
   rollback baseline yet.
4. **Reload and positively identify production, then migrate.** In a fresh
   operator shell, securely load the production migration URL and the approved
   non-secret host+port authority, database, and role identifiers. The reviewed
   checker accepts exactly one `sslmode=require` query parameter and optionally
   exactly one `channel_binding=require`; it rejects every other query parameter.
   It also rejects malformed/local/non-PostgreSQL URLs, missing credentials,
   fragments, and any identifier drift. Every failure is one fixed message that
   cannot echo connection material. It then makes one read-only query through
   that TLS endpoint and compares
   `current_database()` and `current_user` with the approved identifiers:
   ```bash
   cleanup_migration_database_environment() {
     unset MIGRATION_DATABASE_URL
     unset EXPECTED_PRODUCTION_DATABASE_AUTHORITY EXPECTED_PRODUCTION_DATABASE_NAME
     unset EXPECTED_PRODUCTION_MIGRATION_ROLE
   }
   trap cleanup_migration_database_environment EXIT
   trap 'exit 128' HUP INT TERM
   test -n "${MIGRATION_DATABASE_URL:-}" || exit 1
   test -n "${EXPECTED_PRODUCTION_DATABASE_AUTHORITY:-}" || exit 1
   test -n "${EXPECTED_PRODUCTION_DATABASE_NAME:-}" || exit 1
   test -n "${EXPECTED_PRODUCTION_MIGRATION_ROLE:-}" || exit 1
   npm run db:target-check || exit $?
   ```
   Keep this same dedicated shell and its cleanup traps active through pre-flight,
   baseline capture, and migration.
   The check must succeed against the exact TLS endpoint; then verify its selected
   production branch in the provider console and rerun pre-flight queries 1-7,
   including ownership and immediate lock checks. Abort on any mismatch,
   privilege drift, unexpected long transaction/lock, or a rehearsal duration
   that did not fit comfortably inside the two-minute statement bound.

   After every query passes, capture the rollback pair exactly once. This command
   independently revalidates the URL and connected identity, uses
   `statement_timestamp()` and the user count in one statement, and refuses to
   run after the enrollment tables exist. Use `--silent` so stdout is exactly one
   JSON object; copy that object directly into the approved secret manager as the
   immutable `PRODUCTION_ROLLBACK_BASELINE`. Do not use ordinary `npm run`, put
   the output in command substitution/history, rerun the capture, or replace the
   stored pair:
   ```bash
   npm run --silent db:cutover-baseline || exit $?
   ```

   With enrollment still restricted and all direct database writes frozen,
   immediately apply nothing except the migration—no manual SQL and no `db push`:
   ```bash
   migration_exit_code=0
   npm run db:migrate:deploy || migration_exit_code=$?
   cleanup_migration_database_environment
   trap - EXIT HUP INT TERM
   if [ "$migration_exit_code" -ne 0 ]; then
     exit "$migration_exit_code"
   fi
   unset -f cleanup_migration_database_environment
   unset migration_exit_code
   ```
   Run the block in the dedicated fresh operator shell. It preserves a migration
   failure as the shell's exit status while clearing the connection and identity
   variables on success, failure, or an interrupt (except untrappable `SIGKILL`).
   `drizzle.config.ts` deliberately does not fall back to `DATABASE_URL`, so an
   unset variable fails loudly instead of hitting the wrong database.
5. **Validate the migrated schema.** Confirm `UserStatus` is exactly
   `pending, active, suspended, revoked`, the `user.status` default is `pending`,
   both enrollment tables exist, and their lifecycle/uniqueness indexes exist.
6. **Deploy Workflow Worker first**, from the clean release checkout:
   ```bash
   test -n "${CLOUDFLARE_ACCOUNT_ID:-}" || exit 1
   CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
     npx wrangler deploy --config wrangler.workflow.jsonc || exit $?
   ```
7. **Deploy web Worker at 100%.** Do **not** canary — the old and new enrollment
   flows cannot safely coexist against a migrated schema. A failed build must
   exit the dedicated shell before Wrangler can reuse an older `.open-next`
   artifact:
   ```bash
   test -n "${CLOUDFLARE_ACCOUNT_ID:-}" || exit 1
   npm run cloudflare:build || exit $?
   CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
     npx wrangler deploy --config wrangler.jsonc || exit $?
   unset CLOUDFLARE_ACCOUNT_ID
   ```
8. **Smoke under restriction.** Require health `200`; `/join`, `/join/complete`,
   the exact friendly `/auth/error?error=signup_disabled&flow=enrollment` page,
   and new APIs must no longer have the old-release `404`. Use two disposable
   verified Google identities with one code and verify separate workspaces. Make
   a pending claim, rotate, and prove the old code/claim fails. Make another
   pending claim against the replacement, use the standalone **Disable code**
   action, prove that code and its issued claim fail, and verify the admin API
   reports zero active codes. Create and retain one final undistributed code.
   Complete the pre-cutover legacy invitation, then suspend, restore, and revoke
   smoke users while verifying session/device/claim invalidation and capacity
   recovery.
9. **Lift the IP restriction**, keep the rate rules, and monitor Worker errors,
   OAuth failures, rate-limit analytics, and health latency for 30 minutes.
10. **Distribute only after monitoring succeeds.** Send the retained `#code=`
    enrollment link privately through the approved secret-sharing channel; never
    place it in the change ticket, chat logs, analytics, or source control.

## Rollback

First apply an all-user maintenance deny to the production hostname, allowing
only the read-only health probe. There is no operator/tester IP bypass during a
rollback: this freeze must cover every application route, including
`/api/auth/*`, `/api/enrollment/*`, `/api/invitations/*`, and
`/api/admin/enrollment*`. Keep it continuously active through the gate, Worker
rollback, and old-Worker verification. Freeze every direct/manual database write
for the same period.

Pause automated health probes during the gate. Send one harmless non-health GET
probe and require Cloudflare Security Events to show that the maintenance rule
blocked it before the Worker; the same request must not appear as a Worker
invocation. In Workers Observability, select the exact production web Worker and
require no active/incomplete invocation that began before the freeze and no
post-freeze invocation. If either view is unavailable or cannot prove those
conditions, do not roll back; keep the freeze and forward-fix.

In a fresh rollback shell, securely load the approved production connection,
identifiers, and the unchanged JSON object captured before migration as
`PRODUCTION_ROLLBACK_BASELINE`. Then run the reviewed command:

```bash
cleanup_rollback_database_environment() {
  unset MIGRATION_DATABASE_URL PRODUCTION_ROLLBACK_BASELINE
  unset EXPECTED_PRODUCTION_DATABASE_AUTHORITY EXPECTED_PRODUCTION_DATABASE_NAME
  unset EXPECTED_PRODUCTION_MIGRATION_ROLE
}
trap cleanup_rollback_database_environment EXIT
trap 'exit 128' HUP INT TERM
test -n "${MIGRATION_DATABASE_URL:-}" || exit 1
test -n "${EXPECTED_PRODUCTION_DATABASE_AUTHORITY:-}" || exit 1
test -n "${EXPECTED_PRODUCTION_DATABASE_NAME:-}" || exit 1
test -n "${EXPECTED_PRODUCTION_MIGRATION_ROLE:-}" || exit 1
test -n "${PRODUCTION_ROLLBACK_BASELINE:-}" || exit 1
rollback_gate_exit_code=0
npm run db:rollback-check || rollback_gate_exit_code=$?
cleanup_rollback_database_environment
trap - EXIT HUP INT TERM
if [ "$rollback_gate_exit_code" -ne 0 ]; then
  exit "$rollback_gate_exit_code"
fi
unset -f cleanup_rollback_database_environment
unset rollback_gate_exit_code
```

The command intentionally takes at least 300 seconds and emits success only
after two complete samples separated by that fixed interval. Each sample uses
one parameterized statement to revalidate connected database/role identity,
reject a future baseline, require no other active database client, waiting lock,
or prepared transaction, and require zero enrollment-code/claim rows, zero users
created since the baseline, and the unchanged total user count. It never prints
the URL, baseline, identity, or counts. Keep the edge and database freeze active,
leave health probes paused, and continue watching both Cloudflare views for the
entire interval. Any command failure or edge activity invalidates the attempt;
resolve the cause and restart the full command, or forward-fix.

Only after that gate passes may you roll back **only the web Worker** to the
privately captured post-pepper old-code version and leave the database forward.
Read-only verification must first confirm the selected account, Worker
name/custom domain, current version, and captured rollback version. Keep
Wrangler's confirmation prompt:

```bash
cleanup_rollback_worker_environment() {
  unset CLOUDFLARE_ACCOUNT_ID WEB_ROLLBACK_VERSION
}
trap cleanup_rollback_worker_environment EXIT
trap 'exit 128' HUP INT TERM
test -n "${CLOUDFLARE_ACCOUNT_ID:-}" || exit 1
test -n "${WEB_ROLLBACK_VERSION:-}" || exit 1
worker_rollback_exit_code=0
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  npx wrangler deployments list --config wrangler.jsonc || worker_rollback_exit_code=$?
if [ "$worker_rollback_exit_code" -eq 0 ]; then
  CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
    npx wrangler rollback "$WEB_ROLLBACK_VERSION" --config wrangler.jsonc \
      --message '0016 pre-enrollment rollback' || worker_rollback_exit_code=$?
fi
cleanup_rollback_worker_environment
trap - EXIT HUP INT TERM
if [ "$worker_rollback_exit_code" -ne 0 ]; then
  exit "$worker_rollback_exit_code"
fi
unset -f cleanup_rollback_worker_environment
unset worker_rollback_exit_code
```

After the frozen old-Worker verification succeeds, resume the health monitor.
The guarded command blocks have already cleared the database, baseline,
identity, account, and rollback-version variables. Keep the signup and enrollment
deny active when reopening existing-user routes.

The reviewed pre-cutover code tolerates the migrated schema for **existing** users:
it never references the enrollment tables, and legacy users keep `active`, which
is what its `authorizeRequest` requires.

Do not reopen enrollment while old code is serving. Once any enrollment code,
claim, or user created since the cutover baseline exists, keep enrollment
restricted, use the owner disable action where available, and forward-fix
instead of rolling back. Even after an eligible rollback, retain the enrollment
and signup deny when lifting maintenance for existing-user traffic. A database
restore is last resort and requires explicit data-loss approval. Never
manually activate a user to work around enrollment; that bypasses durable claims,
capacity accounting, and audit controls.

## Known follow-up work

- **`deckforge_*` cookie compat shims** (`lib/i18n.ts:15-17`,
  `server/auth/generate-access.ts:9-12`) are due for removal after 2026-09-01.
- **`BinancePublicationDraft` V1 contract migration** still needs its own window;
  unrelated to 0016.
