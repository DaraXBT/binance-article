-- Data-only expand step. The legacy table remains authoritative for commands that were
-- already in flight so their V1 recipe hash remains verifiable during the compatibility window.
INSERT INTO "PublicationDraft" (
  "id", "workspaceId", "articleId", "createdByUserId", "target", "version", "revision",
  "status", "payload", "recipeHash", "expiresAt", "publishedUrl", "createdAt", "updatedAt"
)
SELECT
  legacy."id",
  legacy."workspaceId",
  legacy."articleId",
  legacy."createdByUserId",
  'binance-square'::"PublicationTarget",
  2,
  legacy."revision",
  legacy."status",
  jsonb_build_object(
    'title', legacy."title",
    'markdown', legacy."markdown",
    'cover', legacy."cover",
    'orderedAssetIds', legacy."orderedAssetIds"
  ),
  NULL,
  legacy."expiresAt",
  legacy."publishedUrl",
  legacy."createdAt",
  legacy."updatedAt"
FROM "BinancePublicationDraft" legacy
ON CONFLICT DO NOTHING;

-- Terminal commands can be linked to the generic draft immediately. Active legacy commands
-- deliberately retain only draftId so the server continues to emit their exact V1 recipe.
UPDATE "PublisherCommand" command
SET "publicationDraftId" = command."draftId"
WHERE command."publicationDraftId" IS NULL
  AND command."draftId" IS NOT NULL
  AND command."state" IN (
    'succeeded'::"PublisherCommandState",
    'failed'::"PublisherCommandState",
    'cancelled'::"PublisherCommandState",
    'expired'::"PublisherCommandState",
    'outcome_unknown'::"PublisherCommandState"
  )
  AND EXISTS (
    SELECT 1 FROM "PublicationDraft" draft
    WHERE draft."id" = command."draftId"
      AND draft."target" = 'binance-square'::"PublicationTarget"
  );

UPDATE "PublishApproval" approval
SET "publicationDraftId" = approval."draftId"
FROM "PublisherCommand" command
WHERE command."id" = approval."commandId"
  AND approval."publicationDraftId" IS NULL
  AND approval."draftId" IS NOT NULL
  AND command."state" IN (
    'succeeded'::"PublisherCommandState",
    'failed'::"PublisherCommandState",
    'cancelled'::"PublisherCommandState",
    'expired'::"PublisherCommandState",
    'outcome_unknown'::"PublisherCommandState"
  )
  AND EXISTS (
    SELECT 1 FROM "PublicationDraft" draft
    WHERE draft."id" = approval."draftId"
      AND draft."target" = 'binance-square'::"PublicationTarget"
  );
