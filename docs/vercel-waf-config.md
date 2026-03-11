# Vercel WAF Rate-Limit Configuration

Configure these rules in the Vercel Dashboard under **Project → Settings → Firewall**.

## Recommended Rules

| Path Pattern | Rate Limit | Window | Action | Rationale |
|---|---|---|---|---|
| `/api/access` | 10 requests | 1 minute | Block | Brute-force access-code guessing |
| `/api/workspace/recover` | 5 requests | 1 minute | Block | Brute-force recovery-key guessing |
| `/api/articles/*/generate` | 3 requests | 1 minute | Block | AI-cost control (Gemini calls) |
| `/api/articles/*/generate-images` | 3 requests | 1 minute | Block | AI-cost control (image generation) |
| `/api/articles/generate-prompt` | 10 requests | 1 minute | Block | AI-cost control (prompt suggestions) |

## Notes

- Rate limits apply per-IP by default in Vercel WAF.
- These values are conservative for private beta. Increase after measuring real usage.
- The `/api/access` and `/api/workspace/recover` limits protect against
  credential-stuffing and should remain tight even in production.
