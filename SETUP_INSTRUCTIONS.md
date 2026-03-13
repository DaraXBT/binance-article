# xArticle Setup Instructions

## 1. Install Dependencies

```bash
npm install
```

## 2. Configure Environment Variables

Create `.env.local` and set the runtime values the app needs.

```bash
GEMINI_API_KEY=your_gemini_api_key
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/xarticle?schema=public"
```

Optional private-access controls:

```bash
# Optional: require users to pass through /access first
APP_ACCESS_CODE=ANGEL

# Optional: enable generation unlock flow and invite-code rotation
GENERATE_ACCESS_CODE=admin-rotation-secret
```

Notes:

- `APP_ACCESS_CODE` protects entry into the app.
- `GENERATE_ACCESS_CODE` does not go directly to end users. It is the admin rotation secret used when issuing one-time article access codes.

## 3. Run Prisma Migrations

```bash
npx prisma migrate dev
```

If you are using a pre-provisioned environment, you can also deploy existing migrations:

```bash
npm run db:migrate:deploy
```

## 4. Generate an Article Access Code for a User

Only needed when `GENERATE_ACCESS_CODE` is set.

```bash
npm run generate-access:create
```

This prints a one-time `gac_...` code. Give that code to the user. The first workspace/browser session that uses it will own it.

If you rotate `GENERATE_ACCESS_CODE`, old generation unlocks stop working and you must mint new invite codes.

## 5. Start the Development Server

```bash
npm run dev
```

Open `http://localhost:3000`.

## 6. Verify the Current User Flow

### If `APP_ACCESS_CODE` is enabled

1. Open `/`
2. Enter the app access code on `/access`
3. The app redirects to `/workspace`

### Workspace onboarding

1. Choose `Create new key` to create a fresh workspace
2. Or choose `Use existing key` to recover an existing workspace with its recovery key

### Generation unlock

1. If generation is locked, the dashboard and `/new` will show disabled generation actions
2. Enter the one-time article access code from the admin
3. Generation is unlocked for the current browser session

## Required Environment Variables

- `GEMINI_API_KEY`
- `BLOB_READ_WRITE_TOKEN`
- `DATABASE_URL`

## Optional Environment Variables

- `APP_ACCESS_CODE`
- `GENERATE_ACCESS_CODE`

## Troubleshooting

### `GEMINI_API_KEY` is not set

Add it to `.env.local` or pull your Vercel environment again.

### `BLOB_READ_WRITE_TOKEN` is not set

Add it to `.env.local`. `next dev` does not load `.env.vercel.local` automatically.

### Prisma migration errors

Check that `DATABASE_URL` points to a reachable database, then rerun:

```bash
npx prisma migrate dev
```

### Users can enter the app but cannot generate

That is expected when `GENERATE_ACCESS_CODE` is enabled and the browser has not been unlocked yet. Issue a fresh invite code with:

```bash
npm run generate-access:create
```

### A previously unlocked user is suddenly blocked from generating

Most likely `GENERATE_ACCESS_CODE` was rotated. Mint a new invite code and have the user unlock again.
