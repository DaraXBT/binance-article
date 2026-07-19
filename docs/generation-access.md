# Generation Access Guide

This document explains the current generation-access model in xArticle.

## Purpose

Generation is the token-spending part of the app:

- prompt suggestion
- article generation
- image retry generation

The app can allow users to browse the dashboard while still blocking these operations until a valid article access code is entered.

## Environment Variables

### `GENERATE_ACCESS_CODE`

This is the admin rotation secret.

- It enables the generation lock
- It is hashed into each issued invite grant
- Changing it invalidates previously unlocked browser sessions on the next protected request

Do not treat this as the user-facing code.

## User-Facing Codes

Users should receive one-time invite codes such as `gac_...`.

These are stored in the database as `GenerationAccessGrant` records and are:

- single-use
- bound to the first workspace/browser session that consumes them
- rejected from other browsers or sessions after first use

## Issuing a Code

With `GENERATE_ACCESS_CODE` set:

```bash
OPERATOR_DATABASE_URL='postgresql://grant_issuer:...@.../app?sslmode=require' \
  npm run generate-access:create
```

This creates a Neon record and prints the raw invite code once, after the
insert succeeds. Only its SHA-256 hash, prefix, rotation-secret hash, explicit
ID, and timestamps are stored.

Use a dedicated `OPERATOR_DATABASE_URL` role that can insert generation grants
but cannot administer the whole database. The command accepts no custom code
through argv because command-line values can leak through shell history and
process listings.

Do not put the operator URL into the web Worker's runtime environment.

## Rotation Workflow

When you want to invalidate all current generation unlocks:

1. Change `GENERATE_ACCESS_CODE`
2. Restart/redeploy the app if needed for the new env to load
3. Issue fresh invite codes
4. Old browser sessions will fail the next protected generation request and must unlock again

## Protected Endpoints

The following routes require a valid generation-access cookie when generation locking is enabled:

- `POST /api/articles`
- `POST /api/articles/generate-prompt`
- `POST /api/articles/[id]/generate`
- `POST /api/articles/[id]/generate-images`

## Browser Behavior

### Allowed

- multiple tabs in the same browser session
- generation from both dashboard and `/new` after one unlock

### Blocked

- reusing the same invite code in another browser profile
- reusing the same invite code on another device
- continuing to use an old unlock after admin rotation

## Related Files

- `server/auth/generate-access.ts`
- `server/auth/generate-access-response.ts`
- `app/api/generate-access/route.ts`
- `scripts/create-generate-access-grant.mjs`
