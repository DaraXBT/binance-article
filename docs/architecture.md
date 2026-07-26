# xArticle current architecture

Status: web-only publishing workspace · UI language: English · default visual
style: `binance-master`

This is the current operating contract for the repository. Historical design
notes and archived migration material remain in their dated folders; this file
describes what is active today.

## Product flow

1. A user joins through an invitation and Google sign-in.
2. The user creates or claims one workspace, then enters source text, a topic
   prompt, or a URL.
3. The web app creates an article revision. The article Workflow Worker
   generates slide copy, captions, slide images, and the dedicated cover from
   the supplied content. After slides/captions persist, the job records a
   revision-scoped durable checkpoint in its log; a Workflow-engine
   re-execution resumes at the image phase instead of re-buying the LLM call,
   and a superseded run cancels as `STALE_REVISION`. Provider failures remain
   terminal — checkpoints never add paid retries.
4. The user reviews and edits the article, images, captions, and cover in the
   article workspace.
5. For Binance Square or X, the web app prepares an immutable, revision-bound
   publication recipe and queues a publisher command.
6. The local companion claims the command, verifies every asset, and prepares
   the target editor in an isolated, companion-managed Chrome publishing
   profile. The user signs in manually in that profile on first use.
7. The user reviews the live editor and approves the exact revision in the web
   app. Only then does the companion perform one scoped final click.

For Gemini generation, a workspace owner may explicitly select an encrypted
workspace key from **Settings → Connections**. Members consume the selected
source but cannot manage it; platform credits remain the default after a first
save. See [workspace Gemini connections](./workspace-ai-credentials.md).

The web app never receives Binance/X passwords, cookies, OAuth tokens, or a
Chrome profile. It also never launches local Chrome or Bun code. X uses the
companion's `X_BROWSER_PROFILE_DIR` profile; Binance uses its shared baoyu
profile, configurable with `BAOYU_CHROME_PROFILE_DIR`. A ZIP is only
an optional local fallback or clean-machine companion distribution; it is not
required for the paired web-to-companion path.

## Runtime boundaries

| Boundary | Responsibility | Sensitive data retained |
|---|---|---|
| OpenNext web Worker | Stateless auth, workspace UI, article APIs, review, approvals, and command transitions | Platform provider key and credential keyring in bindings; workspace plaintext only transiently during prompt and connection requests; no durable local data |
| Article Workflow Worker | Idempotent text/image generation and job progress | Platform provider key and credential keyring in bindings; workspace key plaintext only transiently in one invocation; no browser credentials |
| Neon PostgreSQL | Auth, tenancy, article revisions, quotas, recipes, commands, and audit | Users/sessions, memberships, article and publication content, encrypted workspace Gemini credential records, recipes, command/audit records, and hashes rather than raw one-time secrets |
| Private Cloudflare R2 | Generated covers and slide assets | Private objects addressed by opaque keys |
| Local publisher companion | Asset verification, Chrome preparation, final approved click | OS-keyring token; local Chrome session and files |

Workspace Gemini keys are AES-256-GCM ciphertext in Neon. The web and Workflow
Workers share a versioned keyring binding; plaintext exists only transiently in
the request/job Worker memory and is never included in a job payload, audit
metadata, result, or log.

The health endpoint (`GET /api/health`) reports only database connectivity and
returns `503` when the database is unavailable. Cloudflare observability is
enabled for both the web and article Workflow Workers; logs must remain
redacted and must not contain credentials or full signed URLs.

## Publication state machine

Normal pre-click progression:

`queued → claimed → awaiting_review → approved → publishing → succeeded`

Before `publishing`, a command may be cancelled or expire. After the click
begins, uncertain evidence becomes terminal `outcome_unknown`; the system never
retries that click automatically. Revision numbers and recipe hashes are
rechecked at every transition.

Publisher devices are workspace-scoped and can be `pending`, `active`, or
`revoked`. Revocation disables the bearer token without deleting the audit row;
pair again from **Settings → Connections** when a device must be replaced.

## Visual generation

`binance-master` is the persistence default and chooses exactly one register per
image: Scene, Mechanism, Briefing, or Primer. The other Binance presets remain
available for explicit selection. Binance covers use the 5:2 / 1000×400 output
contract after local crop and focal-point validation.

The UI is English-only so controls and operational messages stay consistent.
The interface does not translate imported source content or control the output
language of generated article copy. Illustration labels are constrained by the
article prompt rather than the UI locale.

## Release contract

Release from a clean checkout and include every Drizzle migration and snapshot.
The release guard rejects dirty trees, untracked release-critical migrations,
and restored Telegram runtime paths. Telegram runtime code and routes are
removed; historical Telegram tables/migrations remain only so existing
databases can migrate forward safely.

Before a live release, operators must still rehearse migrations on a backed-up
production-like branch, pair a disposable browser, and complete one controlled
smoke flow per target. No repository test invents credentials or performs a
live post.

See [README.md](../README.md), [SETUP_INSTRUCTIONS.md](../SETUP_INSTRUCTIONS.md),
and [RELEASE_CHECKLIST.md](../RELEASE_CHECKLIST.md) for commands and operator
procedures.
