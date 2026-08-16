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

- Use a clean checkout of the exact CI-green final release SHA. Require the
  release-tree, test, typecheck, lint, build, Cloudflare dry-run, and Drizzle
  checks to pass for that exact SHA.
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
  migration-role connection and positively verify its authority, database, and
  role with `npm run db:target-check`.
- Temporarily block mutation methods on `/api/workspace/ai-credential` for
  normal traffic while retaining a narrow, fixed operator/tester allowlist for
  the post-deployment smoke. Positively verify a non-allowlisted harmless
  mutation is denied before migration; do not exercise an allowlisted mutation
  until the new Workers are live. Reads and unrelated application traffic may
  remain available.

## Apply and verify

1. Re-run the target identity and immediate lock checks. Abort on an unexpected
   long transaction or waiting lock on `WorkspaceAiCredential`.
2. Run only `npm run db:migrate:deploy`. Do not use `db push`, manual SQL, or a
   modified copy of migration `0015`. The migration's transaction-local
   `lock_timeout = '5s'` and `statement_timeout = '2min'` must remain in place.
   A timeout or other failure is transactional; verify the ledger still ends
   at `0017` before investigating or retrying.
3. Require the ledger to end at `0018`. Inspect `pg_get_constraintdef` and
   confirm the character-only regex and explicit `BETWEEN 24 AND 2048` length
   bound are present. Confirm the modulo check still exists and no credential
   rows violate either constraint.
4. Deploy the Workflow Worker and web Worker from the same exact final SHA.
   Smoke Account settings at the target mobile and desktop viewports.
5. From the pre-approved operator/tester allowlist, use a disposable Gemini key
   to save, test, switch sources, switch back to Platform credits, and delete
   the stored copy. Confirm the same mutation remains denied from a
   non-allowlisted source during the smoke. Revoke the disposable key at Google
   separately. Remove the temporary credential-mutation restriction only after
   this smoke test succeeds.

## Failure and rollback

Before `0018` commits, leave the existing Worker active and fix forward while
the credential-mutation restriction remains in place. After `0018` commits,
do not restore the invalid `{24,2048}` constraint: the repair matches the
original data contract and is compatible with older application readers.
Application rollback eligibility is governed by the already-applied `0017`
publication cutover boundary; never restore a pre-`0017` writer.
