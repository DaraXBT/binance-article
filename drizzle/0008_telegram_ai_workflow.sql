CREATE TYPE "public"."TelegramMessageRole" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."TelegramTaskKind" AS ENUM('chat', 'article', 'image', 'prepare');--> statement-breakpoint
CREATE TYPE "public"."TelegramTaskStatus" AS ENUM('queued', 'running', 'generated', 'delivering', 'succeeded', 'failed', 'cancelled', 'outcome_unknown');--> statement-breakpoint
CREATE TYPE "public"."TelegramTextProvider" AS ENUM('gemini', 'deepseek');--> statement-breakpoint
ALTER TYPE "public"."StorageObjectPurpose" ADD VALUE 'telegram_image';--> statement-breakpoint
CREATE TABLE "TelegramAiMessage" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"workspaceId" text NOT NULL,
	"taskId" text,
	"telegramUserId" text NOT NULL,
	"role" "TelegramMessageRole" NOT NULL,
	"content" text NOT NULL,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TelegramAiTask" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"workspaceId" text NOT NULL,
	"botId" text NOT NULL,
	"updateId" bigint NOT NULL,
	"telegramUserId" text NOT NULL,
	"chatId" text NOT NULL,
	"kind" "TelegramTaskKind" NOT NULL,
	"status" "TelegramTaskStatus" DEFAULT 'queued' NOT NULL,
	"provider" "TelegramTextProvider",
	"model" text,
	"inputText" text,
	"articleId" text,
	"jobId" text,
	"placeholderMessageId" bigint,
	"resultText" text,
	"resultMetadata" jsonb,
	"temporaryAssetKey" text,
	"errorCode" text,
	"errorMessage" text,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"completedAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TelegramAssistantSettings" (
	"userId" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"textProvider" "TelegramTextProvider" DEFAULT 'gemini' NOT NULL,
	"defaultSlideCount" integer DEFAULT 4 NOT NULL,
	"illustrationStyle" text DEFAULT 'pixel-art' NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "TelegramAssistantSettings_defaultSlideCount_check" CHECK ("TelegramAssistantSettings"."defaultSlideCount" BETWEEN 1 AND 8),
	CONSTRAINT "TelegramAssistantSettings_illustrationStyle_check" CHECK ("TelegramAssistantSettings"."illustrationStyle" IN ('pixel-art', 'fantasy-animation', 'lab-notes'))
);
--> statement-breakpoint
CREATE TABLE "TelegramMedia" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"workspaceId" text NOT NULL,
	"taskId" text,
	"storageObjectId" text NOT NULL,
	"prompt" text,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "TelegramAiMessage" ADD CONSTRAINT "TelegramAiMessage_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TelegramAiMessage" ADD CONSTRAINT "TelegramAiMessage_workspaceId_Workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TelegramAiMessage" ADD CONSTRAINT "TelegramAiMessage_taskId_TelegramAiTask_id_fk" FOREIGN KEY ("taskId") REFERENCES "public"."TelegramAiTask"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TelegramAiTask" ADD CONSTRAINT "TelegramAiTask_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TelegramAiTask" ADD CONSTRAINT "TelegramAiTask_workspaceId_Workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TelegramAiTask" ADD CONSTRAINT "TelegramAiTask_articleId_DeckProject_id_fk" FOREIGN KEY ("articleId") REFERENCES "public"."DeckProject"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TelegramAiTask" ADD CONSTRAINT "TelegramAiTask_jobId_JobRun_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."JobRun"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TelegramAssistantSettings" ADD CONSTRAINT "TelegramAssistantSettings_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TelegramMedia" ADD CONSTRAINT "TelegramMedia_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TelegramMedia" ADD CONSTRAINT "TelegramMedia_workspaceId_Workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TelegramMedia" ADD CONSTRAINT "TelegramMedia_taskId_TelegramAiTask_id_fk" FOREIGN KEY ("taskId") REFERENCES "public"."TelegramAiTask"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TelegramMedia" ADD CONSTRAINT "TelegramMedia_storageObjectId_StorageObject_id_fk" FOREIGN KEY ("storageObjectId") REFERENCES "public"."StorageObject"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "TelegramAiMessage_userId_createdAt_idx" ON "TelegramAiMessage" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "TelegramAiMessage_expiresAt_idx" ON "TelegramAiMessage" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "TelegramAiTask_botId_updateId_key" ON "TelegramAiTask" USING btree ("botId","updateId");--> statement-breakpoint
CREATE INDEX "TelegramAiTask_userId_status_createdAt_idx" ON "TelegramAiTask" USING btree ("userId","status","createdAt");--> statement-breakpoint
CREATE INDEX "TelegramAiTask_workspaceId_createdAt_idx" ON "TelegramAiTask" USING btree ("workspaceId","createdAt");--> statement-breakpoint
CREATE INDEX "TelegramAiTask_expiresAt_idx" ON "TelegramAiTask" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "TelegramMedia_storageObjectId_key" ON "TelegramMedia" USING btree ("storageObjectId");--> statement-breakpoint
CREATE INDEX "TelegramMedia_userId_createdAt_idx" ON "TelegramMedia" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "TelegramMedia_expiresAt_idx" ON "TelegramMedia" USING btree ("expiresAt");