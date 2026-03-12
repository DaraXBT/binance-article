-- Align the database with the current Prisma schema.
--
-- The database was originally created via prisma db push with an older schema.
-- The init migration was later baselined (marked applied without running), so
-- enum types were never created, some columns are missing, and the legacy
-- RenderJob table needs to be replaced by JobRun.
--
-- All data tables are currently empty, so destructive changes are safe.

----------------------------------------------------------------------
-- 1. Create missing PostgreSQL enum types
----------------------------------------------------------------------
CREATE TYPE "DeckStatus" AS ENUM ('draft', 'queued', 'generating', 'ready', 'rendering', 'failed');
CREATE TYPE "SlideImageStatus" AS ENUM ('pending', 'generated', 'failed');
CREATE TYPE "JobKind" AS ENUM ('generate', 'generate_images', 'render');
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');
CREATE TYPE "AssetFormat" AS ENUM ('pdf', 'pptx', 'png');

----------------------------------------------------------------------
-- 2. DeckProject: convert status text → enum, add missing FK
----------------------------------------------------------------------
ALTER TABLE "DeckProject" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "DeckProject" ALTER COLUMN "status" TYPE "DeckStatus" USING "status"::"DeckStatus";
ALTER TABLE "DeckProject" ALTER COLUMN "status" SET DEFAULT 'draft';

ALTER TABLE "DeckProject" ADD CONSTRAINT "DeckProject_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

----------------------------------------------------------------------
-- 3. Slide: add missing columns, no enum conversion needed (column didn't exist)
----------------------------------------------------------------------
ALTER TABLE "Slide" ADD COLUMN "imageStatus" "SlideImageStatus" NOT NULL DEFAULT 'pending';
ALTER TABLE "Slide" ADD COLUMN "imageError" TEXT;

----------------------------------------------------------------------
-- 4. RenderAsset: convert format text → enum, add missing column,
--    drop legacy FK to RenderJob
----------------------------------------------------------------------
ALTER TABLE "RenderAsset" ALTER COLUMN "format" DROP DEFAULT;
ALTER TABLE "RenderAsset" ALTER COLUMN "format" TYPE "AssetFormat" USING "format"::"AssetFormat";

ALTER TABLE "RenderAsset" ADD COLUMN "storageProvider" TEXT NOT NULL DEFAULT 'blob';

ALTER TABLE "RenderAsset" DROP CONSTRAINT "RenderAsset_jobId_fkey";

----------------------------------------------------------------------
-- 5. Drop legacy RenderJob table and create JobRun
----------------------------------------------------------------------
DROP TABLE "RenderJob";

CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "JobKind" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "logs" JSONB NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "articleRevisionId" TEXT NOT NULL,
    "runId" TEXT,
    "payload" JSONB,
    "result" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobRun_deckId_createdAt_idx" ON "JobRun"("deckId", "createdAt");
CREATE INDEX "JobRun_workspaceId_createdAt_idx" ON "JobRun"("workspaceId", "createdAt");
CREATE INDEX "JobRun_status_kind_idx" ON "JobRun"("status", "kind");
CREATE INDEX "JobRun_articleRevisionId_idx" ON "JobRun"("articleRevisionId");

ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_deckId_fkey"
  FOREIGN KEY ("deckId") REFERENCES "DeckProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

----------------------------------------------------------------------
-- 6. Re-point RenderAsset.jobId FK to the new JobRun table
----------------------------------------------------------------------
ALTER TABLE "RenderAsset" ADD CONSTRAINT "RenderAsset_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "JobRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
