# Cloudflare edge security configuration

The generation, grant, and recovery routes listed below enforce application
rate limits. Add Cloudflare rate-limiting rules so abusive traffic is rejected
before it consumes Worker or provider capacity. The publisher pairing and
publication-prepare entries are currently edge-only recommendations; they do
not have database-backed attempt limits in the application.

## Recommended edge rules

| Path pattern | Rate limit | Window | Action | Rationale |
|---|---:|---:|---|---|
| `/api/generate-access` | 10 requests | 1 minute | Block | One-time grant guessing |
| `/api/workspace/recover` | 5 requests | 1 minute | Block | Legacy claim-key guessing |
| `/api/articles/*/generate` | 3 requests | 1 minute | Block | Gemini cost control |
| `/api/articles/*/generate-images` | 3 requests | 1 minute | Block | Image-generation cost control |
| `/api/articles/*/generate-cover` | 3 requests | 1 minute | Block | Cover-generation cost control |
| `/api/articles/generate-prompt` | 10 requests | 1 minute | Block | Prompt-generation cost control |
| `/api/publisher/devices/pair` | 10 requests | 1 minute | Block | Pairing-code guessing and replay pressure |
| `/api/articles/*/publications/*/prepare` | 10 requests | 1 minute | Block | Command-creation abuse |

Keep these rules conservative during the private beta and review rate-limit
events before increasing them. Where an application limit exists, edge IP
limits supplement rather than replace it.

Both web and Workflow Wrangler configurations must retain
`global_fetch_strictly_public`. Source imports also reject literal private and
reserved IPv4/IPv6 addresses, revalidate redirects, enforce exact content
types, and cap time and response size.

Do not log full source URLs: query strings and fragments can contain signed
credentials.

## Bindings and secrets

The web Worker requires `DATABASE_URL`, Better Auth/Google OAuth secrets, and
`GEMINI_API_KEY`, plus the private `ARTICLE_ASSETS` R2 binding and the
`ARTICLE_JOBS` Workflow binding. The Workflow Worker requires `DATABASE_URL`,
`GEMINI_API_KEY`, and the same private R2 bucket. `DEEPSEEK_API_KEY` is optional
and belongs only on the Workflow Worker when that provider is enabled.

Do not restore a Telegram Worker, webhook, route, or OAuth secret. Historical
Telegram migrations remain database history only.

## Observability and health

Keep Wrangler observability enabled for both the web and article Workflow
Workers and apply log retention appropriate for private article metadata.
Server error logging redacts bearer tokens, password/secret-shaped values, API
keys, and URL credentials.

`GET /api/health` checks database connectivity only and returns a minimal
`ok`/`degraded` response with `Cache-Control: no-store`. Treat it as a liveness
signal, not a complete R2, Workflow, Gemini, or companion readiness probe.
