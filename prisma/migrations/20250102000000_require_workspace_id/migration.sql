-- Backfill: assign orphaned DeckProjects to a workspace via their session.
-- If a DeckProject has a sessionId but no workspaceId, look up the workspace
-- through WorkspaceSession and assign it.
UPDATE "DeckProject" d
SET "workspaceId" = ws."workspaceId"
FROM "WorkspaceSession" ws
WHERE d."sessionId" = ws."sessionId"
  AND d."workspaceId" IS NULL
  AND d."sessionId" IS NOT NULL
  AND d."sessionId" != '';

-- Remove any DeckProjects that still have no workspace after backfill.
-- These are truly orphaned records from before workspaces existed.
DELETE FROM "DeckProject" WHERE "workspaceId" IS NULL;

-- Make workspaceId required
ALTER TABLE "DeckProject" ALTER COLUMN "workspaceId" SET NOT NULL;

-- Drop the legacy sessionId column
ALTER TABLE "DeckProject" DROP COLUMN "sessionId";

-- Drop the sessionId index (it was on the dropped column)
-- Prisma will handle this automatically since the column is gone.
