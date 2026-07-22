# Generation Access Guide

This document explains the current generation-access model in xArticle.

## Purpose

Generation is the token-spending part of the app:

- prompt suggestion
- article generation
- image retry generation
- dedicated cover generation

The app can allow users to browse the dashboard while still blocking these operations until a valid article access code is entered.

## Environment Variables

### `GENERATE_ACCESS_CODE`

This is the admin rotation secret.

- It enables the generation lock
- It is hashed into each issued invite grant
- Changing it invalidates previously unlocked browser sessions on the next protected request

Do not treat this as the user-facing code.

If `GENERATE_ACCESS_CODE` is empty, the generation lock is disabled. The
variable enables rotation and validation; it is not a reusable browser unlock.

## User-Facing Codes

Users should receive one-time invite codes such as `gac_...`.

These are stored in the database as `GenerationAccessGrant` records and are:

- single-use
- bound to the first workspace/browser session that consumes them
- rejected from other browsers or sessions after first use

The raw `gac_...` value is printed once. The database stores its SHA-256 hash,
short prefix, rotation-secret hash, bindings, status, and timestamps—not the
raw grant.

## Issuing a Code

With `GENERATE_ACCESS_CODE` set:

Load `GENERATE_ACCESS_CODE` into the current operator process from the approved
secret manager before running the command; `npm run` does not automatically
load `.env.local` for this script.

```bash
OPERATOR_DATABASE_URL='postgresql://grant_issuer:...@.../app?sslmode=require' \
  npm run generate-access:create
```

This creates a Neon record and prints the raw invite code once, after the
insert succeeds. The stored record contains the hash, prefix, rotation hash,
workspace/session bindings, lifecycle status, and timestamps described above;
the raw grant is never stored.

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

The browser receives only the grant ID in an HttpOnly, SameSite=Strict cookie.
Production cookies are Secure. Every protected request rechecks the grant's
rotation hash, workspace, authenticated session, and revocation status.

## Protected Endpoints

The following routes require a valid generation-access cookie when generation locking is enabled:

- `POST /api/articles`
- `POST /api/articles/generate-prompt`
- `POST /api/articles/[id]/generate`
- `POST /api/articles/[id]/generate-images`
- `POST /api/articles/[id]/generate-cover`

## Browser Behavior

### Allowed

- multiple tabs in the same browser session
- generation from both dashboard and `/new` after one unlock
- cover and failed-image retries from the article editor after one unlock

### Blocked

- reusing the same invite code in another browser profile
- reusing the same invite code on another device
- continuing to use an old unlock after admin rotation

The API applies a database-backed attempt limit before consuming a code. Add a
conservative Cloudflare edge rule as a second layer; see
[cloudflare-security-config.md](./cloudflare-security-config.md).

## Related Files

- `server/auth/generate-access.ts`
- `server/auth/generate-access-response.ts`
- `app/api/generate-access/route.ts`
- `scripts/create-generate-access-grant.mjs`
