CREATE TYPE "public"."WorkspaceOrigin" AS ENUM('legacy', 'account');--> statement-breakpoint
ALTER TABLE "Workspace" ADD COLUMN "origin" "WorkspaceOrigin";--> statement-breakpoint
UPDATE "Workspace"
SET "origin" = CASE
  WHEN "accessKeyPrefix" ~ '^acct_[a-f0-9]{8}$' THEN 'account'::"WorkspaceOrigin"
  ELSE 'legacy'::"WorkspaceOrigin"
END;--> statement-breakpoint
ALTER TABLE "Workspace" ALTER COLUMN "origin" SET DEFAULT 'legacy';--> statement-breakpoint
ALTER TABLE "Workspace" ALTER COLUMN "origin" SET NOT NULL;
