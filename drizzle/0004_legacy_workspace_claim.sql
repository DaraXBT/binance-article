ALTER TABLE "Workspace" ADD COLUMN "legacyClaimExpiresAt" timestamp(3) with time zone;--> statement-breakpoint
UPDATE "Workspace" AS workspace
SET "legacyClaimExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '30 days'
WHERE NOT EXISTS (
    SELECT 1
    FROM "WorkspaceMember" AS member
    WHERE member."workspaceId" = workspace."id"
  )
  AND workspace."legacyClaimExpiresAt" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_owner_key"
ON "WorkspaceMember" USING btree ("workspaceId")
WHERE "role" = 'owner';
