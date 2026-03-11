-- CreateEnum
CREATE TYPE "DeckStatus" AS ENUM ('draft', 'queued', 'generating', 'ready', 'rendering', 'failed');

-- CreateEnum
CREATE TYPE "SlideImageStatus" AS ENUM ('pending', 'generated', 'failed');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('generate', 'generate_images', 'render');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AssetFormat" AS ENUM ('pdf', 'pptx', 'png');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "accessKeyHash" TEXT NOT NULL,
    "accessKeyPrefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceSession" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeckProject" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'default',
    "customTheme" JSONB,
    "illustrationStyle" TEXT NOT NULL DEFAULT 'pixel-art',
    "status" "DeckStatus" NOT NULL DEFAULT 'draft',
    "generationRevision" INTEGER NOT NULL DEFAULT 0,
    "lastCompletedRevision" INTEGER NOT NULL DEFAULT 0,
    "sessionId" TEXT DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeckProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Slide" (
    "id" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "bullets" JSONB NOT NULL,
    "notes" TEXT,
    "imageUrl" TEXT,
    "imageStatus" "SlideImageStatus" NOT NULL DEFAULT 'pending',
    "imageError" TEXT,
    "imagePrompt" TEXT,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Slide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptionPackage" (
    "id" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "blogTitle" TEXT,
    "blogMeta" TEXT,
    "blogIntro" TEXT,
    "blogSections" JSONB,
    "blogTags" JSONB,
    "xSingle1" TEXT,
    "xSingle2" TEXT,
    "xSingle3" TEXT,
    "xThread" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptionPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderAsset" (
    "id" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "format" "AssetFormat" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER,
    "storageProvider" TEXT NOT NULL DEFAULT 'blob',
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenderAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_accessKeyHash_key" ON "Workspace"("accessKeyHash");

-- CreateIndex
CREATE INDEX "Workspace_accessKeyPrefix_idx" ON "Workspace"("accessKeyPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceSession_sessionId_key" ON "WorkspaceSession"("sessionId");

-- CreateIndex
CREATE INDEX "WorkspaceSession_workspaceId_idx" ON "WorkspaceSession"("workspaceId");

-- CreateIndex
CREATE INDEX "DeckProject_sessionId_idx" ON "DeckProject"("sessionId");

-- CreateIndex
CREATE INDEX "DeckProject_workspaceId_updatedAt_idx" ON "DeckProject"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "DeckProject_status_idx" ON "DeckProject"("status");

-- CreateIndex
CREATE INDEX "Slide_deckId_idx" ON "Slide"("deckId");

-- CreateIndex
CREATE UNIQUE INDEX "Slide_deckId_order_key" ON "Slide"("deckId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "CaptionPackage_deckId_key" ON "CaptionPackage"("deckId");

-- CreateIndex
CREATE INDEX "CaptionPackage_deckId_idx" ON "CaptionPackage"("deckId");

-- CreateIndex
CREATE INDEX "RenderAsset_deckId_idx" ON "RenderAsset"("deckId");

-- CreateIndex
CREATE INDEX "RenderAsset_jobId_idx" ON "RenderAsset"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "RenderAsset_deckId_filename_key" ON "RenderAsset"("deckId", "filename");

-- CreateIndex
CREATE INDEX "JobRun_deckId_createdAt_idx" ON "JobRun"("deckId", "createdAt");

-- CreateIndex
CREATE INDEX "JobRun_workspaceId_createdAt_idx" ON "JobRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "JobRun_status_kind_idx" ON "JobRun"("status", "kind");

-- CreateIndex
CREATE INDEX "JobRun_articleRevisionId_idx" ON "JobRun"("articleRevisionId");

-- AddForeignKey
ALTER TABLE "WorkspaceSession" ADD CONSTRAINT "WorkspaceSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeckProject" ADD CONSTRAINT "DeckProject_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slide" ADD CONSTRAINT "Slide_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "DeckProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptionPackage" ADD CONSTRAINT "CaptionPackage_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "DeckProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderAsset" ADD CONSTRAINT "RenderAsset_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "DeckProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderAsset" ADD CONSTRAINT "RenderAsset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "DeckProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

