# Publication kind cutover runbook (migration 0017)

Migration 0017 is a contract cutover, not a rolling or zero-downtime migration.
It makes `kind` required and replaces the publication-draft conflict key
`(workspaceId, articleId, target)` with `(workspaceId, articleId, target, kind)`.
The old web release omits `kind` and still targets the old conflict key, so it
must not perform publication writes after 0017 commits.

## Before the window

- Use a clean checkout of the exact CI-green release SHA. Require
  `npm run release:tree-check`, `npm run db:check`, and the full test/typecheck
  gates to pass.
- Take and verify a restorable production backup or branch. Rehearse 0017 on a
  production-sized restore using the production migration role and record the
  duration. It must finish comfortably within the migration's transaction-local
  `lock_timeout = '5s'` and `statement_timeout = '2min'` limits.
- Confirm the production migration ledger ends at 0016 and the schema matches
  the 0016 snapshot. Abort on drift.
- Install the protocol-v2/V3-capable publisher companion, but keep every
  companion paused until the new web release is live and smoke-tested.

## Publication-write maintenance

Before applying 0017, block publication mutations at the edge for both article
publication routes and all publisher-command lifecycle routes. This includes
draft saves, prepare, approve, claim, begin, editor-ready, result, and abort.
Read-only publication views and unrelated application traffic may remain live.

Pause companion polling first, then wait until every existing publisher command
is terminal (`succeeded`, `failed`, `cancelled`, `expired`, or
`outcome_unknown`). Do not migrate while a command is claimed, awaiting review
or approval, approved, or publishing. Positively verify the maintenance rule is
blocking a harmless publication mutation before continuing.

## Cutover order

1. Re-run the migration-target identity check and the immediate database lock
   check from the approved operator shell. Abort on target drift, an unexpected
   long transaction, or a waiting lock on `PublicationDraft` or
   `PublisherCommand`.
2. With publication writes still blocked, apply only
   `npm run db:migrate:deploy`. Do not use `db push` or manual schema SQL. A
   timeout or other failure rolls the transaction back; verify the ledger still
   ends at 0016 before retrying.
3. Validate that `PublicationKind` is exactly `post, article`; both `kind`
   columns are non-null with no null rows; `PublicationDraft.version` defaults
   to 3 and accepts 2 or 3; the old target-only unique index is absent; and the
   new target-and-kind unique index is valid.
4. Deploy the new web Worker at 100%. Do not canary or allow an old Worker to
   share the migrated database. Keep publication writes blocked throughout the
   deployment.
5. Start only a protocol-v2/V3-capable companion, then perform the smoke checks
   below under the maintenance allowlist.
6. Lift publication-write maintenance only after all smoke checks pass. Monitor
   web and companion errors, command latency, and failed/outcome-unknown commands.

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

- **Before 0017 commits:** leave the old web release active. A migration failure
  is transactional; verify the ledger/schema still end at 0016, correct the
  cause, and retry while publication writes remain blocked.
- **After 0017 commits:** the old web release is no longer a safe writer, even
  before the first V3 draft. Do not remove `kind`, recreate the old conflict
  index, or redeploy the old web release with ad-hoc SQL.
- **After any V3 or second-kind write:** the data model has crossed an irreversible
  compatibility boundary. Keep publication maintenance active and forward-fix.
  Restoring the pre-cutover backup is a disaster-recovery action requiring a
  full write freeze and explicit acceptance/reconciliation of all post-backup
  data loss; it is not an application rollback.
