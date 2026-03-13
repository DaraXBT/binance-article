# xArticle

xArticle is a private article-to-slides workspace built with Next.js, Prisma, and Gemini. Users can enter the app with an optional app access code, attach or recover a workspace, and then generate articles only after unlocking generation with a one-time article access code.

## What It Does

- Generate article-backed slide decks from free text, prompts, or URLs
- Keep work scoped to a browser-attached workspace with a recovery key
- Lock token-spending generation behind one-time invite codes bound to a single browser session
- Retry failed image generation from the article page
- Produce blog and X/Twitter captions together with the slide output

## Access Model

xArticle now has three separate access layers:

1. `APP_ACCESS_CODE` (optional)
   - Gates entry to the app at `/access`
   - If unset, the app is publicly reachable

2. Workspace recovery key
   - Lets a user choose `Create new key` or `Use existing key`
   - Controls which workspace the browser is attached to

3. Generation access invite code
   - Unlocks AI generation for the current browser session
   - Uses one-time DB-backed grants
   - The first workspace/browser session that uses a code owns it
   - If `GENERATE_ACCESS_CODE` changes, all existing generation unlocks become invalid on the next protected request

## Requirements

- Recent Node.js LTS
- npm
- `GEMINI_API_KEY`
- `BLOB_READ_WRITE_TOKEN`
- Database configured through `DATABASE_URL`

## Local Setup

1. Install dependencies

```bash
npm install
```

2. Create `.env.local`

```bash
GEMINI_API_KEY=your_gemini_api_key
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/xarticle?schema=public"

# Optional app entry gate
APP_ACCESS_CODE=ANGEL

# Optional generation gate rotation secret
GENERATE_ACCESS_CODE=admin-rotation-secret
```

3. Apply migrations and generate Prisma client

```bash
npx prisma migrate dev
```

4. If generation access is enabled, mint a one-time article access code for a tester

```bash
npm run generate-access:create
```

5. Start the app

```bash
npm run dev
```

Open `http://localhost:3000`.

## User Flow

If `APP_ACCESS_CODE` is enabled:

1. Open `/`
2. Enter the app access code on `/access`
3. You will be redirected to `/workspace`

Then:

1. Choose `Create new key` to make a new workspace, or `Use existing key` to recover one
2. After the workspace is attached, open the dashboard
3. If generation is locked, unlock it once with the latest article access code from the admin
4. Generate from the homepage, `/new`, or retry failed images from an article page

## Admin Workflow for Generation Access

`GENERATE_ACCESS_CODE` is not given directly to users. It acts as a rotation secret for invite issuance.

When you want to allow a user to generate:

1. Set or update `GENERATE_ACCESS_CODE` in the environment
2. Issue a one-time invite code:

```bash
npm run generate-access:create
```

3. Send the printed `gac_...` code to the user

Optional: provide your own code instead of generating a random one

```bash
npm run generate-access:create -- gac_custom_code_here
```

Rotation behavior:

- Change `GENERATE_ACCESS_CODE`
- Mint new invite codes
- Old generation unlocks will stop working on the next protected request

## Main Routes

### Pages

- `/` - dashboard
- `/workspace` - dashboard alias used after app-access login
- `/access` - app-level access gate
- `/new` - article creation wizard
- `/articles/[id]` - article studio, editor, preview, captions

### APIs

- `POST /api/access` - validate app access code and set app cookie
- `GET /api/workspace` - bootstrap workspace and generation lock state
- `POST /api/workspace` - create a new workspace for the current browser session
- `POST /api/workspace/recover` - recover an existing workspace using its recovery key
- `POST /api/generate-access` - consume a one-time generation invite and set generation cookie
- `POST /api/articles` - create an article shell
- `POST /api/articles/generate-prompt` - generate AI prompt suggestions
- `POST /api/articles/[id]/generate` - start article generation
- `POST /api/articles/[id]/generate-images` - retry article image generation
- `GET /api/jobs/[jobId]` - poll workflow progress

## Useful Commands

```bash
npm run dev
npm run build
npm run test
npm run typecheck
npm run prisma:generate
npm run db:migrate:deploy
npm run generate-access:create
```

## Project Structure

```text
app/
  access/                  app entry gate
  articles/[id]/           article studio
  api/                     API routes
  new/                     article wizard
  page.tsx                 dashboard
  workspace/page.tsx       dashboard alias

components/
  access/                  app access UI
  home/                    dashboard
  workspace/               workspace onboarding and recovery

lib/
  db.ts                    article persistence helpers
  generate-access.ts       generation access exports
  hooks.ts                 React Query hooks
  schemas.ts               Zod schemas
  workspace.ts             workspace bootstrap and recovery helpers

server/
  auth/                    cookies and access helpers
  modules/                 workspace, articles, jobs

prisma/
  schema.prisma            DB schema
  migrations/              schema history

scripts/
  create-generate-access-grant.mjs
  setup-db.sh
```

## Docs

- [SETUP_INSTRUCTIONS.md](./SETUP_INSTRUCTIONS.md)
- [GETTING_STARTED.md](./GETTING_STARTED.md)
- [docs/generation-access.md](./docs/generation-access.md)
- [docs/vercel-waf-config.md](./docs/vercel-waf-config.md)
