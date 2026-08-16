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

The independent base64url modulo check remains unchanged. Never edit or
re-stamp applied migration `0015`.

## Preconditions

- Use a clean checkout of the exact CI-green final release SHA. Require the
  release-tree, test, typecheck, lint, build, Cloudflare dry-run, and Drizzle
  checks to pass for that exact SHA.
- Confirm the production migration ledger ends at exactly `0017` and the live
  schema matches the `0017` snapshot. Abort on any other state or drift.
- Take and verify a restorable production snapshot. Use the guarded production
  migration-role connection and positively verify its authority, database, and
  role with `npm run db:target-check`.
- Temporarily block mutation methods on `/api/workspace/ai-credential`. Reads
  and unrelated application traffic may remain available.

## Apply and verify

1. Re-run the target identity and immediate lock checks. Abort on an unexpected
   long transaction or waiting lock on `WorkspaceAiCredential`.
2. Run only `npm run db:migrate:deploy`. Do not use `db push`, manual SQL, or a
   modified copy of migration `0015`. A failure is transactional; verify the
   ledger still ends at `0017` before investigating or retrying.
3. Require the ledger to end at `0018`. Inspect `pg_get_constraintdef` and
   confirm the character-only regex and explicit `BETWEEN 24 AND 2048` length
   bound are present. Confirm the modulo check still exists and no credential
   rows violate either constraint.
4. Deploy the Workflow Worker and web Worker from the same exact final SHA.
   Smoke Account settings at the target mobile and desktop viewports.
5. With a disposable Gemini key, save, test, switch sources, switch back to
   Platform credits, and delete the stored copy. Revoke the disposable key at
   Google separately. Remove the temporary credential-mutation restriction
   only after this smoke test succeeds.

## Failure and rollback

Before `0018` commits, leave the existing Worker active and fix forward while
the credential-mutation restriction remains in place. After `0018` commits,
do not restore the invalid `{24,2048}` constraint: the repair matches the
original data contract and is compatible with older application readers.
Application rollback eligibility is governed by the already-applied `0017`
publication cutover boundary; never restore a pre-`0017` writer.
