# Cloudflare edge security configuration

Application routes already enforce authenticated, database-backed rate limits.
Add Cloudflare rate-limiting rules as a second layer so abusive traffic is
rejected before it consumes Worker or provider capacity.

## Recommended edge rules

| Path pattern | Rate limit | Window | Action | Rationale |
|---|---:|---:|---|---|
| `/api/generate-access` | 10 requests | 1 minute | Block | One-time grant guessing |
| `/api/workspace/recover` | 5 requests | 1 minute | Block | Legacy claim-key guessing |
| `/api/articles/*/generate` | 3 requests | 1 minute | Block | Gemini cost control |
| `/api/articles/*/generate-images` | 3 requests | 1 minute | Block | Image-generation cost control |
| `/api/articles/generate-prompt` | 10 requests | 1 minute | Block | Prompt-generation cost control |

Keep these rules conservative during the private beta and review rate-limit
events before increasing them. Edge IP limits supplement—not replace—the
application's authenticated-user limits.

Both web and Workflow Wrangler configurations must retain
`global_fetch_strictly_public`. Source imports also reject literal private and
reserved IPv4/IPv6 addresses, revalidate redirects, enforce exact content
types, and cap time and response size.

Do not log full source URLs: query strings and fragments can contain signed
credentials.
