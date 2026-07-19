# xArticle Setup Instructions

## 1. Install

```bash
npm install
```

Use Node.js 22 or newer. Install Bun separately for `publisher-companion`.

## 2. Configure local environment

Copy `.env.example` to `.env.local`. At minimum configure:

- `DATABASE_URL`: PostgreSQL/Neon runtime URL with TLS for remote hosts.
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`.
- Google OAuth client ID and secret.
- Gemini credentials while the generation provider is enabled.
- Private asset storage credentials/bindings for the selected runtime.

Telegram is optional. If enabled, configure its OAuth client, bot token, webhook secret, and separate Worker environment. Never reuse a production database superuser for the Telegram Worker.

Store production secrets in Cloudflare secret bindings. Do not commit `.env*`, print tokens, or bundle local environment files into Worker output.

## 3. Database

Use a separate least-privileged runtime role and migration role. Review migrations, back up deployed data, then apply with the dedicated URL:

```bash
MIGRATION_DATABASE_URL='postgresql://...' npm run db:check
MIGRATION_DATABASE_URL='postgresql://...' npm run db:migrate:deploy
```

The legacy workspace migration stamps only then-unowned workspaces with a 30-day claim deadline. New workspaces receive no claim deadline. Do not edit that deadline per request or extend it with an environment variable.

## 4. Better Auth and invitations

Configure the Google callback URL for the deployment origin. Bootstrap the first owner through the controlled operator procedure, then create invitations from the owner administration surface. The application limits the private beta to ten active users plus pending invitations.

## 5. Cloudflare resources

- Deploy the web application as an OpenNext Worker.
- Bind a private `ARTICLE_ASSETS` R2 bucket; do not enable `r2.dev`.
- Deploy Telegram as a separate Worker with only its required secrets.
- Keep migrations outside build and deployment bundles.
- Run the compressed bundle-size gates before deployment.

No deployment or live migration is performed by repository verification commands.

## 6. Local publisher companion

```bash
cd publisher-companion
bun install --frozen-lockfile
printf '%s\n' "$PAIRING_CODE" | bun run src/main.ts pair --api https://your-app.example
bun run src/main.ts run
```

Pass the one-time pairing code through the hidden prompt or stdin, never argv. The companion refuses plaintext token storage, uses one process lock, verifies downloaded assets, and never retries a Binance publish click.

## 7. Verify before release

```bash
npm test
npm run typecheck
npm run lint
MIGRATION_DATABASE_URL='postgresql://localhost/binance_article' npm run db:check
npm run telegram:dry-run

cd publisher-companion
bun test
bun run typecheck
```

Use a clean checkout for OpenNext builds because `.env*` files can be embedded in Worker code. Do not run the Cloudflare build from a checkout containing local secret files.
