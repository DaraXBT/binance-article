CREATE TYPE "public"."PublicationTarget" AS ENUM('binance-square', 'x');--> statement-breakpoint
CREATE TYPE "public"."PublishApprovalVia" AS ENUM('web', 'telegram');--> statement-breakpoint
CREATE TABLE "PublicationDraft" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"articleId" text NOT NULL,
	"createdByUserId" text NOT NULL,
	"target" "PublicationTarget" NOT NULL,
	"version" integer DEFAULT 2 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" "PublicationDraftStatus" DEFAULT 'draft' NOT NULL,
	"payload" jsonb NOT NULL,
	"recipeHash" text,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"publishedUrl" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "PublicationDraft_version_check" CHECK ("PublicationDraft"."version" = 2),
	CONSTRAINT "PublicationDraft_revision_positive_check" CHECK ("PublicationDraft"."revision" > 0),
	CONSTRAINT "PublicationDraft_recipeHash_sha256_check" CHECK ("PublicationDraft"."recipeHash" IS NULL OR "PublicationDraft"."recipeHash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "PublishApproval" DROP CONSTRAINT "PublishApproval_callbackTokenHash_sha256_check";--> statement-breakpoint
ALTER TABLE "PublishApproval" ALTER COLUMN "draftId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "PublishApproval" ALTER COLUMN "telegramUserId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "PublishApproval" ALTER COLUMN "callbackTokenHash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "PublisherCommand" ALTER COLUMN "draftId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "PublishApproval" ADD COLUMN "publicationDraftId" text;--> statement-breakpoint
ALTER TABLE "PublishApproval" ADD COLUMN "approvedVia" "PublishApprovalVia" DEFAULT 'telegram' NOT NULL;--> statement-breakpoint
ALTER TABLE "PublisherCommand" ADD COLUMN "publicationDraftId" text;--> statement-breakpoint
ALTER TABLE "PublisherCommand" ADD COLUMN "target" "PublicationTarget" DEFAULT 'binance-square' NOT NULL;--> statement-breakpoint
ALTER TABLE "PublicationDraft" ADD CONSTRAINT "PublicationDraft_workspaceId_Workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PublicationDraft" ADD CONSTRAINT "PublicationDraft_articleId_DeckProject_id_fk" FOREIGN KEY ("articleId") REFERENCES "public"."DeckProject"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PublicationDraft" ADD CONSTRAINT "PublicationDraft_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "PublicationDraft_workspaceId_updatedAt_idx" ON "PublicationDraft" USING btree ("workspaceId","updatedAt");--> statement-breakpoint
CREATE INDEX "PublicationDraft_articleId_target_revision_idx" ON "PublicationDraft" USING btree ("articleId","target","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "PublicationDraft_workspaceId_articleId_target_key" ON "PublicationDraft" USING btree ("workspaceId","articleId","target");--> statement-breakpoint
CREATE INDEX "PublicationDraft_status_expiresAt_idx" ON "PublicationDraft" USING btree ("status","expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "PublicationDraft_id_revision_key" ON "PublicationDraft" USING btree ("id","revision");--> statement-breakpoint
ALTER TABLE "PublishApproval" ADD CONSTRAINT "PublishApproval_publicationDraftId_PublicationDraft_id_fk" FOREIGN KEY ("publicationDraftId") REFERENCES "public"."PublicationDraft"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PublisherCommand" ADD CONSTRAINT "PublisherCommand_publicationDraftId_PublicationDraft_id_fk" FOREIGN KEY ("publicationDraftId") REFERENCES "public"."PublicationDraft"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "PublishApproval_publicationDraftId_state_idx" ON "PublishApproval" USING btree ("publicationDraftId","state");--> statement-breakpoint
CREATE INDEX "PublisherCommand_publicationDraftId_revision_idx" ON "PublisherCommand" USING btree ("publicationDraftId","revision");--> statement-breakpoint
CREATE INDEX "PublisherCommand_target_state_createdAt_idx" ON "PublisherCommand" USING btree ("target","state","createdAt");--> statement-breakpoint
ALTER TABLE "PublishApproval" ADD CONSTRAINT "PublishApproval_draft_reference_check" CHECK ("PublishApproval"."draftId" IS NOT NULL OR "PublishApproval"."publicationDraftId" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "PublishApproval" ADD CONSTRAINT "PublishApproval_channel_metadata_check" CHECK (("PublishApproval"."approvedVia" = 'web' AND "PublishApproval"."telegramUserId" IS NULL AND "PublishApproval"."callbackTokenHash" IS NULL)
      OR ("PublishApproval"."approvedVia" = 'telegram' AND "PublishApproval"."telegramUserId" IS NOT NULL AND "PublishApproval"."callbackTokenHash" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "PublishApproval" ADD CONSTRAINT "PublishApproval_callbackTokenHash_sha256_check" CHECK ("PublishApproval"."callbackTokenHash" IS NULL OR "PublishApproval"."callbackTokenHash" ~ '^[a-f0-9]{64}$');--> statement-breakpoint
ALTER TABLE "PublisherCommand" ADD CONSTRAINT "PublisherCommand_draft_reference_check" CHECK ("PublisherCommand"."draftId" IS NOT NULL OR "PublisherCommand"."publicationDraftId" IS NOT NULL);