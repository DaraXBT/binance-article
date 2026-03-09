# DeckForge - AI-Powered Presentation Creator

DeckForge is a modern web application that uses Google's Gemini AI to automatically generate beautiful presentation decks. Simply provide a topic and let AI create your slides, complete with speaker notes and social media captions.

## Features

### Core Features
- **AI-Powered Generation**: Uses Google Gemini to generate slide content based on your topic
- **Smart Customization**: Configure slide count, target audience, presentation style, and theme
- **Resizable Studio Interface**: Professional editor with side-by-side slide editing, preview, and captions
- **Slide Management**: Drag-and-drop reordering, edit, add, and delete slides
- **Caption Generation**: Automatic generation of blog captions (SEO, meta, intro, tags) and Twitter/X content

### Design System
- **15+ Built-in Themes**: Professional color-coded presentation themes
- **Responsive Layout**: Works seamlessly on desktop and tablet
- **Real-time Preview**: See changes instantly as you edit
- **Modern UI**: Built with shadcn/ui and Tailwind CSS

## Tech Stack

### Frontend
- **Next.js 16**: React framework with App Router
- **React 19**: Latest React features
- **TypeScript**: Type-safe development
- **Tailwind CSS v4**: Utility-first styling
- **shadcn/ui**: High-quality UI components
- **TanStack Query**: Data synchronization and caching
- **react-resizable-panels**: Resizable panel layout

### Backend
- **Next.js API Routes**: Serverless functions
- **Prisma**: Type-safe ORM
- **SQLite**: Local database (easily upgradeable to PostgreSQL)

### AI & Services
- **Google Gemini API**: Content and caption generation
- **p-queue**: In-memory job queue for rendering (upgradeable to Redis/BullMQ)

## Getting Started

### Prerequisites
- Node.js 18+ and npm/pnpm
- Google Gemini API key (free tier available)
- Vercel Blob read/write token for runtime image storage

### Installation

1. **Get the Gemini API Key**
   - Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
   - Create a new API key
   - Keep it safe

2. **Set Up Environment Variables**
   ```bash
   # Pull Vercel-managed envs if this project is linked
   vercel env pull .env.local

   # Or create .env.local manually for local dev
   cat <<'EOF' > .env.local
   GEMINI_API_KEY=your_api_key_here
   BLOB_READ_WRITE_TOKEN=your_blob_rw_token_here
   DATABASE_URL="file:./prisma/dev.db"
   EOF
   ```

3. **Install Dependencies**
   ```bash
   pnpm install
   ```

4. **Set Up Database**
   ```bash
   # Run Prisma migrations
   npx prisma migrate dev --name init
   
   # Or use the setup script
   bash scripts/setup-db.sh
   ```

5. **Start Development Server**
   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
deckforge/
├── app/
│   ├── page.tsx                 # Dashboard page
│   ├── new/                     # Creator wizard pages
│   │   ├── page.tsx
│   │   └── steps/
│   ├── decks/[id]/
│   │   └── page.tsx            # Main studio page
│   └── api/                     # API routes
│       ├── decks/              # Deck operations
│       ├── jobs/               # Job status tracking
│       └── ...
├── components/
│   ├── ui/                      # shadcn/ui components
│   ├── deck-card.tsx           # Deck preview card
│   ├── slide-editor.tsx        # Slide editing interface
│   ├── slide-preview.tsx       # Live slide preview
│   ├── slide-list.tsx          # Slide navigation
│   ├── caption-viewer.tsx      # Caption display
│   └── wizard-stepper.tsx      # Multi-step wizard UI
├── lib/
│   ├── prisma.ts              # Prisma client
│   ├── gemini.ts              # Gemini API client
│   ├── job-queue.ts           # Job queue system
│   ├── render-engine.ts       # Asset rendering
│   ├── db.ts                  # Database operations
│   ├── file-utils.ts          # File management
│   ├── hooks.ts               # React Query hooks
│   ├── schemas.ts             # Zod validation
│   ├── config.ts              # App configuration
├── prisma/
│   └── schema.prisma          # Database schema
└── scripts/
    └── setup-db.sh            # Database setup
```

## Key Components

### API Routes

**POST /api/decks**
Create a new deck project

**POST /api/decks/[id]/generate**
Generate slides and captions using Gemini

**POST /api/decks/[id]/render**
Start a background render job (PNG/PPTX/PDF)

**GET /api/decks/[id]**
Fetch deck with all associated data

**PATCH /api/decks/[id]/slides/[slideId]**
Update a slide's content

**GET /api/jobs/[jobId]**
Poll job status and logs

### Database Models

- **DeckProject**: Main presentation entity
- **Slide**: Individual presentation slides
- **CaptionPackage**: Generated captions and social media content
- **RenderAsset**: Generated files (PNG, PPTX, PDF)
- **RenderJob**: Background job tracking

## Configuration

### Themes
Edit `lib/config.ts` to customize themes:

```typescript
export const THEMES = [
  {
    id: 'professional',
    name: 'Professional',
    description: 'Corporate/Business',
    colors: { primary: '...', secondary: '...', ... }
  },
  // ... more themes
];
```

### Gemini Settings
Configure in `lib/gemini.ts`:

```typescript
const model = genAI.getGenerativeModel({ 
  model: 'gemini-1.5-flash' // or gemini-1.5-pro for better quality
});
```

## Production Deployment

### Database
For production, upgrade to PostgreSQL:

```bash
# Update DATABASE_URL in .env
DATABASE_URL="postgresql://user:password@host:port/dbname"

# Run migrations
npx prisma migrate deploy
```

### Job Queue
For high-volume rendering, upgrade to Redis:

```bash
# Install Redis client
pnpm add redis

# See lib/job-queue.ts for integration
```

### File Storage
Runtime-generated slide images use Vercel Blob in both local and hosted environments.
Local `next dev` also needs a valid `BLOB_READ_WRITE_TOKEN`; `.env.vercel.local` is not loaded automatically by Next.js.

For other distributed deployments, replace the blob integration with your preferred object storage:

```typescript
// Replace local file-utils.ts with cloud provider
// Options: AWS S3, Google Cloud Storage, Vercel Blob, etc.
```

### Environment Variables
```bash
GEMINI_API_KEY=your_api_key
BLOB_READ_WRITE_TOKEN=your_blob_rw_token
DATABASE_URL=your_database_url
```

## Usage Flow

1. **Dashboard** (`/`)
   - View recent decks
   - Start creating a new deck

2. **Creator Wizard** (`/new`)
   - **Step 1**: Define content (topic, title, slide count)
   - **Step 2**: Configure settings (audience, style, notes)
   - **Step 3**: Choose theme (15+ options)
   - **Step 4**: Generate (AI creates slides & captions)

3. **Studio** (`/decks/[id]`)
   - Edit slides individually
   - Drag-reorder slides
   - Live preview with theme
   - Copy blog captions and Twitter threads
   - Export to PNG/PPTX/PDF (render jobs)

## Advanced Features

### Real-time Job Monitoring
The job queue system tracks rendering progress with:
- Progress percentage (0-100%)
- Timestamped logs
- Error handling and recovery

### Caption Generation
Automatic generation of:
- **Blog**: SEO title, meta description, intro, section content, tags
- **Twitter**: 3 individual tweets + 1 thread format

### Extensible Themes
Add new themes by:
1. Defining colors in `lib/config.ts`
2. Creating theme-specific styling in components
3. Supporting custom color overrides

## Performance Optimization

- **Server-side Gemini calls**: API key never exposed to client
- **React Query caching**: Reduce API requests
- **Optimistic updates**: Instant UI feedback
- **Lazy loading**: Components load on demand
- **Streaming responses**: Future-ready for token streaming

## Security

- ✅ Server-side API key management
- ✅ Input validation with Zod
- ✅ Safe file path handling (no directory traversal)
- ✅ Type-safe database queries
- ✅ CORS-configured API routes

## Contributing

DeckForge is designed to be extensible. Key areas for enhancement:

- [ ] Add more themes
- [ ] Implement custom styling/brand colors
- [ ] Add speaker notes editor
- [ ] Implement presentation mode
- [ ] Add slide templates
- [ ] Support markdown/HTML content
- [ ] Integration with cloud storage
- [ ] Team collaboration features
- [ ] Version control for decks
- [ ] Analytics and usage tracking

## Troubleshooting

### "GEMINI_API_KEY is not set"
- Add your key to `.env.local`

### "BLOB_READ_WRITE_TOKEN is not set"
- Add your Blob token to `.env.local`
- Or run `vercel env pull .env.local` before `pnpm dev`
- Restart the dev server

### Database errors
```bash
# Reset database
rm -rf ./data
npx prisma migrate dev --name init
```

### Slides not generating
- Check Gemini API quota
- Verify API key has generative AI access
- Check the server logs for error details

## License

MIT - Feel free to use and modify for your projects.

## Support

For issues or questions, check the server logs and ensure:
1. Gemini API key is valid
2. Database is properly initialized
3. All dependencies are installed
4. Node.js version is 18+

## Future Roadmap

- [ ] Collaborative editing
- [ ] Real-time websocket updates
- [ ] Advanced rendering with Puppeteer/Playwright
- [ ] Custom font support
- [ ] Slide templates and galleries
- [ ] Team workspaces
- [ ] Advanced analytics
- [ ] API for external integrations
