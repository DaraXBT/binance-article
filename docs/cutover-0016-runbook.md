# Shared enrollment cutover runbook (migration 0016)

This is the operator script for the one window that ships shared enrollment. It
supplements `RELEASE_CHECKLIST.md`. Keep account IDs, database project IDs,
deployment version IDs, database URLs, IP allowlists, and scratch paths in the
private operator shell or change ticket—not in this repository.
Secret values, database URLs, enrollment codes/links, claim or invitation
tokens, OAuth credentials, and disposable identity details belong only in the
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
| Release checkout | Fresh `mktemp -d` clone with no local/secret-bearing env files; tracked `.env.example` is allowed and both Worker dry-runs pass |

Before the window, record the live status of `/api/health`, `/join`,
`/join/complete`, and `/api/enrollment/claim` in the private change ticket. After
deployment, the new pages and API must no longer return the old-release `404`.

## What prep proved about 0016

- **Existing statuses are preserved.** The migration adds `pending` to `UserStatus` and sets it as the
  new column default, but existing rows are never rewritten: it drops the default,
  casts in place, then re-adds the default. A local rehearsal seeded at `0015`
  confirmed `active`/`suspended`/`revoked` all survived, and only a newly inserted
  row picked up `pending`.
- **Existing values are cast-compatible.** The old enum
  `('active','suspended','revoked')` is a strict subset of the new one. Production
  must still pass the dependency, permission, and lock preflight.
- **Sign-in is unaffected for existing users.** The enrollment gate is wired only
  to Better Auth's `user.create.before` hook (`server/auth/better-auth.ts:70-74`),
  so it never runs for an existing account. `authorizeRequest` still requires
  `status === 'active'`, which legacy users keep.
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

-- 3. Exactly one row expected: public.user.status. Anything else needs review.
SELECT c.relname AS table_name, a.attname AS column_name
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_type  t ON t.oid = a.atttypid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typname = 'UserStatus'
  AND NOT a.attisdropped AND c.relkind IN ('r','v','m');

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
```

Abort the window if (1) is not 16, (2) is 0, (3) does not return exactly
`public.user.status`,
(4) exceeds 7, or (5) returns anything non-NULL.

## Cutover

1. **Back up.** Take a restorable Neon branch/snapshot and record its project and
   branch IDs in the private change ticket. Keep that pre-cutover recovery point
   untouched.
2. **Rehearse on a separate restore/fork.** Restore or fork the backup into a
   disposable rehearsal branch, point `MIGRATION_DATABASE_URL` there, and run
   step 4's command. Confirm statuses survive and the untouched backup can still
   be restored before touching production.
3. **Owner session + edge controls.** Confirm an active owner session before
   applying the restriction. Per `RELEASE_CHECKLIST.md` step 6:
   `/api/enrollment/claim` and `/api/invitations/accept` at 10 req/10 min,
   `/api/auth/callback/google` at 20 req/10 min. Apply the temporary operator/tester
   IP restriction to `/join*`, `/api/enrollment/claim`,
   `/api/enrollment/complete`, `/api/invitations/accept`,
   `/api/auth/sign-in/social`, and `/api/auth/callback/google`. Confirm it is
   active before migration.
4. **Apply the migration.** Nothing else — no manual SQL, no `db push`:
   ```bash
   : "${MIGRATION_DATABASE_URL:?Load the migration-role URL securely first}"
   npm run db:migrate:deploy
   unset MIGRATION_DATABASE_URL
   ```
   `drizzle.config.ts` deliberately does not fall back to `DATABASE_URL`, so an
   unset variable fails loudly instead of hitting the wrong database.
5. **Validate the migrated schema.** Confirm `UserStatus` is exactly
   `pending, active, suspended, revoked`, the `user.status` default is `pending`,
   both enrollment tables exist, and their lifecycle/uniqueness indexes exist.
6. **Deploy Workflow Worker first**, from the clean release checkout:
   ```bash
   : "${CLOUDFLARE_ACCOUNT_ID:?Select the production account first}"
   npx wrangler deploy --config wrangler.workflow.jsonc
   ```
7. **Deploy web Worker at 100%.** Do **not** canary — the old and new enrollment
   flows cannot safely coexist against a migrated schema.
   ```bash
   : "${CLOUDFLARE_ACCOUNT_ID:?Select the production account first}"
   npm run cloudflare:build
   npx wrangler deploy --config wrangler.jsonc
   ```
8. **Smoke under restriction.** Require health `200`; `/join`, `/join/complete`,
   the exact friendly `/auth/error?error=signup_disabled&flow=enrollment` page,
   and new APIs must no longer have the old-release `404`. Use two disposable
   verified Google identities with one code and verify separate workspaces. Make
   a pending claim, rotate, and prove the old code/claim fails; retain a final
   undistributed code. Complete one live legacy invitation, then suspend,
   restore, and revoke smoke users while verifying session/device/claim
   invalidation and capacity recovery.
9. **Lift the IP restriction**, keep the rate rules, and monitor Worker errors,
   OAuth failures, rate-limit analytics, and health latency for 30 minutes.

## Rollback

First re-enable the complete temporary enrollment restriction. Only if no shared
code claim, newly pending account, or completed enrollment exists may you roll
back **only the web Worker** to the privately captured post-pepper old-code
version and leave the database forward:

```bash
: "${CLOUDFLARE_ACCOUNT_ID:?Select the production account first}"
: "${WEB_ROLLBACK_VERSION:?Capture the active post-pepper version first}"
npx wrangler rollback "$WEB_ROLLBACK_VERSION" --config wrangler.jsonc --yes \
  --message '0016 pre-enrollment rollback'
```

The reviewed pre-cutover code tolerates the migrated schema for **existing** users:
it never references the enrollment tables, and legacy users keep `active`, which
is what its `authorizeRequest` requires.

Do not reopen enrollment while old code is serving. Once any shared enrollment
state exists, keep enrollment restricted and forward-fix instead of rolling back. A
database restore is last resort and requires explicit data-loss approval. Never
manually activate a user to work around enrollment; that bypasses durable claims,
capacity accounting, and audit controls.

## Known follow-up work

- **`deckforge_*` cookie compat shims** (`lib/i18n.ts:15-17`,
  `server/auth/generate-access.ts:9-12`) are due for removal after 2026-09-01.
- **`BinancePublicationDraft` V1 contract migration** still needs its own window;
  unrelated to 0016.
