CREATE TYPE "GenerationAccessGrantStatus" AS ENUM ('active', 'consumed', 'revoked');

CREATE TABLE "GenerationAccessGrant" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codePrefix" TEXT NOT NULL,
    "status" "GenerationAccessGrantStatus" NOT NULL DEFAULT 'active',
    "boundWorkspaceId" TEXT,
    "boundSessionId" TEXT,
    "consumedAt" TIMESTAMP(3),
    "envCodeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenerationAccessGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GenerationAccessGrant_codeHash_key" ON "GenerationAccessGrant"("codeHash");
CREATE INDEX "GenerationAccessGrant_codePrefix_idx" ON "GenerationAccessGrant"("codePrefix");
CREATE INDEX "GenerationAccessGrant_boundWorkspaceId_idx" ON "GenerationAccessGrant"("boundWorkspaceId");
CREATE INDEX "GenerationAccessGrant_boundSessionId_idx" ON "GenerationAccessGrant"("boundSessionId");
CREATE INDEX "GenerationAccessGrant_status_envCodeHash_idx" ON "GenerationAccessGrant"("status", "envCodeHash");

ALTER TABLE "GenerationAccessGrant" ADD CONSTRAINT "GenerationAccessGrant_boundWorkspaceId_fkey" FOREIGN KEY ("boundWorkspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
