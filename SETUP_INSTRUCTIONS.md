# DeckForge - Setup Instructions

## Quick Start

### 1. Set Your Runtime Environment Variables
Before running the app, you need to set your Google Gemini API key and Blob token:

1. Go to [Google AI Studio](https://aistudio.google.com) and create a free API key
2. Create or copy a Vercel Blob read/write token for this project
3. In Vercel-linked local development, run:
   ```bash
   vercel env pull .env.local
   ```
4. If you are setting values manually, add:
   - **Key**: `GEMINI_API_KEY`
   - **Value**: Paste your API key from Google AI Studio
   - **Key**: `BLOB_READ_WRITE_TOKEN`
   - **Value**: Paste your Vercel Blob read/write token

### 2. Start the Development Server
```bash
pnpm dev
```

The app will start at `http://localhost:3000`

### 3. Create Your First Deck
1. Click **"Create New Deck"** on the dashboard
2. Follow the 4-step wizard:
   - **Step 1**: Enter your topic (e.g., "Introduction to Machine Learning")
   - **Step 2**: Set audience and style preferences
   - **Step 3**: Pick a theme
   - **Step 4**: Click "Generate" to create slides with AI

### 4. Edit Your Deck
- Use the main studio to edit slides
- View live preview on the right
- Generate blog posts and Twitter captions automatically

## Database Setup

The app uses SQLite with Prisma. The database is automatically created in `.env.local` when you first run the app.

If you need to reset the database:
```bash
# Delete the SQLite file
rm prisma/dev.db

# Re-initialize Prisma
pnpm exec prisma generate
pnpm dev
```

## Environment Variables

Required:
- `GEMINI_API_KEY` - Your Google Gemini API key (get from https://aistudio.google.com)
- `BLOB_READ_WRITE_TOKEN` - Required for slide image storage in local and hosted environments

Optional:
- `DATABASE_URL` - Database connection string (defaults to SQLite in `.env.local`)

## File Structure

```
app/
  ├── page.tsx                 # Dashboard
  ├── new/                      # Creator wizard
  │   ├── page.tsx
  │   └── steps/               # Wizard steps
  ├── decks/[id]/              # Main studio
  │   └── page.tsx
  ├── api/                      # API routes
  │   ├── decks/
  │   ├── jobs/
  │   └── ...
  └── layout.tsx

lib/
  ├── config.ts                # Theme presets
  ├── gemini.ts                # Gemini AI client
  ├── job-queue.ts             # Render job queue
  ├── db.ts                    # Database queries
  ├── hooks.ts                 # React Query hooks
  └── schemas.ts               # Zod validation

components/
  ├── deck-card.tsx
  ├── slide-editor.tsx
  ├── slide-preview.tsx
  ├── caption-viewer.tsx
  └── ...

prisma/
  └── schema.prisma            # Database schema
```

## Troubleshooting

### "GEMINI_API_KEY is not set"
Make sure you've added the environment variable in the project settings (Vars tab).

### "BLOB_READ_WRITE_TOKEN is not set"
Make sure `.env.local` contains the Blob token. `.env.vercel.local` is not loaded automatically by `pnpm dev`.

### Database errors
Try deleting `prisma/dev.db` and restarting the dev server.

### Build fails on Vercel
Run `pnpm install` locally to update `pnpm-lock.yaml`, then push the changes.

## Next Steps

1. **Customize themes** in `lib/config.ts` to add your own color schemes
2. **Upgrade to PostgreSQL** - Update `prisma/schema.prisma` provider and deploy to production
3. **Add authentication** - Use Supabase Auth or Auth.js for user accounts
4. **Deploy to Vercel** - Push to GitHub and deploy with one click

For more details, see `README.md` and `GETTING_STARTED.md`.
