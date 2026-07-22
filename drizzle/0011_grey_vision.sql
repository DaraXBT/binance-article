ALTER TYPE "public"."StorageObjectPurpose" ADD VALUE 'cover_image' BEFORE 'render';--> statement-breakpoint
CREATE TABLE "ArticleCover" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"articleId" text NOT NULL,
	"generationRevision" integer DEFAULT 0 NOT NULL,
	"style" text DEFAULT 'binance-master' NOT NULL,
	"styleMode" text,
	"prompt" text,
	"status" "SlideImageStatus" DEFAULT 'pending' NOT NULL,
	"sourceAssetId" text,
	"error" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ArticleCover_generationRevision_nonnegative_check" CHECK ("ArticleCover"."generationRevision" >= 0),
	CONSTRAINT "ArticleCover_styleMode_check" CHECK ("ArticleCover"."styleMode" IS NULL OR "ArticleCover"."styleMode" IN ('scene', 'mechanism', 'briefing', 'primer'))
);
--> statement-breakpoint
ALTER TABLE "ArticleCover" ADD CONSTRAINT "ArticleCover_workspaceId_Workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ArticleCover" ADD CONSTRAINT "ArticleCover_articleId_DeckProject_id_fk" FOREIGN KEY ("articleId") REFERENCES "public"."DeckProject"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ArticleCover" ADD CONSTRAINT "ArticleCover_sourceAssetId_StorageObject_id_fk" FOREIGN KEY ("sourceAssetId") REFERENCES "public"."StorageObject"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "ArticleCover_articleId_key" ON "ArticleCover" USING btree ("articleId");--> statement-breakpoint
CREATE INDEX "ArticleCover_workspaceId_updatedAt_idx" ON "ArticleCover" USING btree ("workspaceId","updatedAt");--> statement-breakpoint
CREATE INDEX "ArticleCover_status_updatedAt_idx" ON "ArticleCover" USING btree ("status","updatedAt");