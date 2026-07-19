CREATE TYPE "public"."AssetFormat" AS ENUM('pdf', 'pptx', 'png');--> statement-breakpoint
CREATE TYPE "public"."DeckStatus" AS ENUM('draft', 'queued', 'generating', 'ready', 'rendering', 'failed');--> statement-breakpoint
CREATE TYPE "public"."GenerationAccessGrantStatus" AS ENUM('active', 'consumed', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."JobKind" AS ENUM('generate', 'generate_images', 'render');--> statement-breakpoint
CREATE TYPE "public"."JobStatus" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."SlideImageStatus" AS ENUM('pending', 'generated', 'failed');--> statement-breakpoint
CREATE TABLE "CaptionPackage" (
	"id" text PRIMARY KEY NOT NULL,
	"deckId" text NOT NULL,
	"blogTitle" text,
	"blogMeta" text,
	"blogIntro" text,
	"blogSections" jsonb,
	"blogTags" jsonb,
	"xSingle1" text,
	"xSingle2" text,
	"xSingle3" text,
	"xThread" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "DeckProject" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"content" text NOT NULL,
	"theme" text DEFAULT 'default' NOT NULL,
	"customTheme" jsonb,
	"illustrationStyle" text DEFAULT 'pixel-art' NOT NULL,
	"status" "DeckStatus" DEFAULT 'draft' NOT NULL,
	"generationRevision" integer DEFAULT 0 NOT NULL,
	"lastCompletedRevision" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "GenerationAccessGrant" (
	"id" text PRIMARY KEY NOT NULL,
	"codeHash" text NOT NULL,
	"codePrefix" text NOT NULL,
	"status" "GenerationAccessGrantStatus" DEFAULT 'active' NOT NULL,
	"boundWorkspaceId" text,
	"boundSessionId" text,
	"consumedAt" timestamp (3),
	"envCodeHash" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "JobRun" (
	"id" text PRIMARY KEY NOT NULL,
	"deckId" text NOT NULL,
	"workspaceId" text NOT NULL,
	"kind" "JobKind" NOT NULL,
	"status" "JobStatus" DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"logs" jsonb NOT NULL,
	"errorCode" text,
	"errorMessage" text,
	"articleRevisionId" text NOT NULL,
	"runId" text,
	"payload" jsonb,
	"result" jsonb,
	"startedAt" timestamp (3),
	"completedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "RateLimitBucket" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"resetAt" timestamp (3) NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "RenderAsset" (
	"id" text PRIMARY KEY NOT NULL,
	"deckId" text NOT NULL,
	"filename" text NOT NULL,
	"format" "AssetFormat" NOT NULL,
	"mimeType" text NOT NULL,
	"filePath" text NOT NULL,
	"fileSize" integer,
	"storageProvider" text DEFAULT 'blob' NOT NULL,
	"jobId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Slide" (
	"id" text PRIMARY KEY NOT NULL,
	"deckId" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"bullets" jsonb NOT NULL,
	"notes" text,
	"imageUrl" text,
	"imageStatus" "SlideImageStatus" DEFAULT 'pending' NOT NULL,
	"imageError" text,
	"imagePrompt" text,
	"order" integer NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"accessKeyHash" text NOT NULL,
	"accessKeyPrefix" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WorkspaceSession" (
	"id" text PRIMARY KEY NOT NULL,
	"sessionId" text NOT NULL,
	"workspaceId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "CaptionPackage" ADD CONSTRAINT "CaptionPackage_deckId_DeckProject_id_fk" FOREIGN KEY ("deckId") REFERENCES "public"."DeckProject"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DeckProject" ADD CONSTRAINT "DeckProject_workspaceId_Workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "GenerationAccessGrant" ADD CONSTRAINT "GenerationAccessGrant_boundWorkspaceId_Workspace_id_fk" FOREIGN KEY ("boundWorkspaceId") REFERENCES "public"."Workspace"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_deckId_DeckProject_id_fk" FOREIGN KEY ("deckId") REFERENCES "public"."DeckProject"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_workspaceId_Workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RenderAsset" ADD CONSTRAINT "RenderAsset_deckId_DeckProject_id_fk" FOREIGN KEY ("deckId") REFERENCES "public"."DeckProject"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RenderAsset" ADD CONSTRAINT "RenderAsset_jobId_JobRun_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."JobRun"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Slide" ADD CONSTRAINT "Slide_deckId_DeckProject_id_fk" FOREIGN KEY ("deckId") REFERENCES "public"."DeckProject"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WorkspaceSession" ADD CONSTRAINT "WorkspaceSession_workspaceId_Workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "CaptionPackage_deckId_key" ON "CaptionPackage" USING btree ("deckId");--> statement-breakpoint
CREATE INDEX "CaptionPackage_deckId_idx" ON "CaptionPackage" USING btree ("deckId");--> statement-breakpoint
CREATE INDEX "DeckProject_workspaceId_updatedAt_idx" ON "DeckProject" USING btree ("workspaceId","updatedAt");--> statement-breakpoint
CREATE INDEX "DeckProject_status_idx" ON "DeckProject" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "GenerationAccessGrant_codeHash_key" ON "GenerationAccessGrant" USING btree ("codeHash");--> statement-breakpoint
CREATE INDEX "GenerationAccessGrant_codePrefix_idx" ON "GenerationAccessGrant" USING btree ("codePrefix");--> statement-breakpoint
CREATE INDEX "GenerationAccessGrant_boundWorkspaceId_idx" ON "GenerationAccessGrant" USING btree ("boundWorkspaceId");--> statement-breakpoint
CREATE INDEX "GenerationAccessGrant_boundSessionId_idx" ON "GenerationAccessGrant" USING btree ("boundSessionId");--> statement-breakpoint
CREATE INDEX "GenerationAccessGrant_status_envCodeHash_idx" ON "GenerationAccessGrant" USING btree ("status","envCodeHash");--> statement-breakpoint
CREATE INDEX "JobRun_deckId_createdAt_idx" ON "JobRun" USING btree ("deckId","createdAt");--> statement-breakpoint
CREATE INDEX "JobRun_workspaceId_createdAt_idx" ON "JobRun" USING btree ("workspaceId","createdAt");--> statement-breakpoint
CREATE INDEX "JobRun_status_kind_idx" ON "JobRun" USING btree ("status","kind");--> statement-breakpoint
CREATE INDEX "JobRun_articleRevisionId_idx" ON "JobRun" USING btree ("articleRevisionId");--> statement-breakpoint
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket" USING btree ("resetAt");--> statement-breakpoint
CREATE INDEX "RenderAsset_deckId_idx" ON "RenderAsset" USING btree ("deckId");--> statement-breakpoint
CREATE INDEX "RenderAsset_jobId_idx" ON "RenderAsset" USING btree ("jobId");--> statement-breakpoint
CREATE UNIQUE INDEX "RenderAsset_deckId_filename_key" ON "RenderAsset" USING btree ("deckId","filename");--> statement-breakpoint
CREATE INDEX "Slide_deckId_idx" ON "Slide" USING btree ("deckId");--> statement-breakpoint
CREATE UNIQUE INDEX "Slide_deckId_order_key" ON "Slide" USING btree ("deckId","order");--> statement-breakpoint
CREATE UNIQUE INDEX "Workspace_accessKeyHash_key" ON "Workspace" USING btree ("accessKeyHash");--> statement-breakpoint
CREATE INDEX "Workspace_accessKeyPrefix_idx" ON "Workspace" USING btree ("accessKeyPrefix");--> statement-breakpoint
CREATE UNIQUE INDEX "WorkspaceSession_sessionId_key" ON "WorkspaceSession" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "WorkspaceSession_workspaceId_idx" ON "WorkspaceSession" USING btree ("workspaceId");