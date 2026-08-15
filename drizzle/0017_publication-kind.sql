SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '2min';--> statement-breakpoint
CREATE TYPE "public"."PublicationKind" AS ENUM('post', 'article');--> statement-breakpoint
ALTER TABLE "PublicationDraft" ADD COLUMN "kind" "PublicationKind";--> statement-breakpoint
ALTER TABLE "PublisherCommand" ADD COLUMN "kind" "PublicationKind";--> statement-breakpoint
UPDATE "PublicationDraft"
SET "kind" = CASE
	WHEN "target" = 'x' THEN 'post'::"PublicationKind"
	ELSE 'article'::"PublicationKind"
END
WHERE "kind" IS NULL;--> statement-breakpoint
UPDATE "PublisherCommand"
SET "kind" = CASE
	WHEN "target" = 'x' THEN 'post'::"PublicationKind"
	ELSE 'article'::"PublicationKind"
END
WHERE "kind" IS NULL;--> statement-breakpoint
ALTER TABLE "PublicationDraft" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "PublisherCommand" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "PublicationDraft" ALTER COLUMN "version" SET DEFAULT 3;--> statement-breakpoint
ALTER TABLE "PublicationDraft" DROP CONSTRAINT "PublicationDraft_version_check";--> statement-breakpoint
ALTER TABLE "PublicationDraft" ADD CONSTRAINT "PublicationDraft_version_check" CHECK ("PublicationDraft"."version" IN (2, 3));--> statement-breakpoint
DROP INDEX "PublicationDraft_workspaceId_articleId_target_key";--> statement-breakpoint
CREATE UNIQUE INDEX "PublicationDraft_workspaceId_articleId_target_kind_key" ON "PublicationDraft" USING btree ("workspaceId","articleId","target","kind");
