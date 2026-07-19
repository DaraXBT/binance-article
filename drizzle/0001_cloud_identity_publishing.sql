CREATE TYPE "public"."UserRole" AS ENUM('owner', 'user');--> statement-breakpoint
CREATE TYPE "public"."UserStatus" AS ENUM('active', 'suspended', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."InvitationStatus" AS ENUM('pending', 'accepted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."PublicationDraftStatus" AS ENUM('draft', 'prepared', 'queued', 'review_ready', 'awaiting_approval', 'authorized', 'publishing', 'published', 'failed', 'cancelled', 'expired', 'outcome_unknown');--> statement-breakpoint
CREATE TYPE "public"."PublishApprovalState" AS ENUM('pending', 'confirmation_required', 'approved', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."PublisherCommandState" AS ENUM('queued', 'claimed', 'awaiting_review', 'awaiting_approval', 'approved', 'publishing', 'succeeded', 'failed', 'cancelled', 'expired', 'outcome_unknown');--> statement-breakpoint
CREATE TYPE "public"."PublisherDeviceStatus" AS ENUM('pending', 'active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."StorageObjectPurpose" AS ENUM('slide_image', 'render', 'publication', 'backup');--> statement-breakpoint
CREATE TYPE "public"."TelegramUpdateStatus" AS ENUM('processing', 'processed', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."UsageKind" AS ENUM('article', 'image', 'workflow_step', 'storage_byte');--> statement-breakpoint
CREATE TYPE "public"."UsageStatus" AS ENUM('reserved', 'committed', 'released');--> statement-breakpoint
CREATE TYPE "public"."WorkspaceMemberRole" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp (3) with time zone,
	"refreshTokenExpiresAt" timestamp (3) with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"token" text NOT NULL,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"status" "UserStatus" DEFAULT 'active' NOT NULL,
	"role" "UserRole" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AuditEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"actorUserId" text,
	"workspaceId" text,
	"eventType" text NOT NULL,
	"subjectType" text NOT NULL,
	"subjectId" text,
	"metadata" jsonb,
	"ipHash" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "BinancePublicationDraft" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"articleId" text NOT NULL,
	"createdByUserId" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" "PublicationDraftStatus" DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"markdown" text NOT NULL,
	"cover" jsonb NOT NULL,
	"orderedAssetIds" jsonb NOT NULL,
	"recipeHash" text,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"publishedUrl" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "BinancePublicationDraft_revision_positive_check" CHECK ("BinancePublicationDraft"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "Invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"tokenHash" text NOT NULL,
	"tokenPrefix" text NOT NULL,
	"status" "InvitationStatus" DEFAULT 'pending' NOT NULL,
	"createdByUserId" text,
	"acceptedByUserId" text,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"acceptedAt" timestamp (3) with time zone,
	"revokedAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "Invitation_tokenHash_sha256_check" CHECK ("Invitation"."tokenHash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "PublishApproval" (
	"id" text PRIMARY KEY NOT NULL,
	"commandId" text NOT NULL,
	"draftId" text NOT NULL,
	"userId" text NOT NULL,
	"telegramUserId" text NOT NULL,
	"callbackTokenHash" text NOT NULL,
	"state" "PublishApprovalState" DEFAULT 'pending' NOT NULL,
	"revision" integer NOT NULL,
	"recipeHash" text NOT NULL,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"consumedAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "PublishApproval_callbackTokenHash_sha256_check" CHECK ("PublishApproval"."callbackTokenHash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "PublishApproval_recipeHash_sha256_check" CHECK ("PublishApproval"."recipeHash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "PublisherCommand" (
	"id" text PRIMARY KEY NOT NULL,
	"draftId" text NOT NULL,
	"deviceId" text,
	"state" "PublisherCommandState" DEFAULT 'queued' NOT NULL,
	"revision" integer NOT NULL,
	"recipeHash" text NOT NULL,
	"idempotencyKey" text NOT NULL,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"claimedAt" timestamp (3) with time zone,
	"resultUrl" text,
	"resultMetadata" jsonb,
	"failureReason" text,
	"completedAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "PublisherCommand_recipeHash_sha256_check" CHECK ("PublisherCommand"."recipeHash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "PublisherDevice" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"workspaceId" text NOT NULL,
	"name" text NOT NULL,
	"tokenHash" text NOT NULL,
	"tokenPrefix" text NOT NULL,
	"status" "PublisherDeviceStatus" DEFAULT 'pending' NOT NULL,
	"protocolVersion" integer DEFAULT 1 NOT NULL,
	"pairedAt" timestamp (3) with time zone,
	"lastSeenAt" timestamp (3) with time zone,
	"revokedAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "PublisherDevice_tokenHash_sha256_check" CHECK ("PublisherDevice"."tokenHash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "StorageObject" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"articleId" text,
	"r2Key" text NOT NULL,
	"purpose" "StorageObjectPurpose" NOT NULL,
	"mimeType" text NOT NULL,
	"sizeBytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"deletedAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "StorageObject_size_nonnegative_check" CHECK ("StorageObject"."sizeBytes" >= 0),
	CONSTRAINT "StorageObject_sha256_check" CHECK ("StorageObject"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "TelegramUpdate" (
	"botId" text NOT NULL,
	"updateId" bigint NOT NULL,
	"telegramUserId" text,
	"payloadHash" text NOT NULL,
	"status" "TelegramUpdateStatus" DEFAULT 'processing' NOT NULL,
	"errorCode" text,
	"processedAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "TelegramUpdate_pkey" PRIMARY KEY("botId","updateId"),
	CONSTRAINT "TelegramUpdate_payloadHash_sha256_check" CHECK ("TelegramUpdate"."payloadHash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "UsageLedger" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"workspaceId" text NOT NULL,
	"kind" "UsageKind" NOT NULL,
	"status" "UsageStatus" DEFAULT 'reserved' NOT NULL,
	"quantity" bigint NOT NULL,
	"period" text NOT NULL,
	"idempotencyKey" text NOT NULL,
	"metadata" jsonb,
	"committedAt" timestamp (3) with time zone,
	"releasedAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "UsageLedger_quantity_positive_check" CHECK ("UsageLedger"."quantity" > 0),
	CONSTRAINT "UsageLedger_period_check" CHECK ("UsageLedger"."period" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "UserQuota" (
	"userId" text PRIMARY KEY NOT NULL,
	"articlesPerMonth" integer DEFAULT 3 NOT NULL,
	"imagesPerMonth" integer DEFAULT 24 NOT NULL,
	"maxSlidesPerArticle" integer DEFAULT 8 NOT NULL,
	"publishingEnabled" boolean DEFAULT true NOT NULL,
	"updatedByUserId" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "UserQuota_articles_nonnegative_check" CHECK ("UserQuota"."articlesPerMonth" >= 0),
	CONSTRAINT "UserQuota_images_nonnegative_check" CHECK ("UserQuota"."imagesPerMonth" >= 0),
	CONSTRAINT "UserQuota_slides_range_check" CHECK ("UserQuota"."maxSlidesPerArticle" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "WorkspaceMember" (
	"workspaceId" text NOT NULL,
	"userId" text NOT NULL,
	"role" "WorkspaceMemberRole" DEFAULT 'owner' NOT NULL,
	"legacyClaimedAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY("workspaceId","userId")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_user_id_fk" FOREIGN KEY ("actorUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_workspaceId_Workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "BinancePublicationDraft" ADD CONSTRAINT "BinancePublicationDraft_workspaceId_Workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "BinancePublicationDraft" ADD CONSTRAINT "BinancePublicationDraft_articleId_DeckProject_id_fk" FOREIGN KEY ("articleId") REFERENCES "public"."DeckProject"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "BinancePublicationDraft" ADD CONSTRAINT "BinancePublicationDraft_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedByUserId_user_id_fk" FOREIGN KEY ("acceptedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PublishApproval" ADD CONSTRAINT "PublishApproval_commandId_PublisherCommand_id_fk" FOREIGN KEY ("commandId") REFERENCES "public"."PublisherCommand"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PublishApproval" ADD CONSTRAINT "PublishApproval_draftId_BinancePublicationDraft_id_fk" FOREIGN KEY ("draftId") REFERENCES "public"."BinancePublicationDraft"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PublishApproval" ADD CONSTRAINT "PublishApproval_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PublisherCommand" ADD CONSTRAINT "PublisherCommand_draftId_BinancePublicationDraft_id_fk" FOREIGN KEY ("draftId") REFERENCES "public"."BinancePublicationDraft"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PublisherCommand" ADD CONSTRAINT "PublisherCommand_deviceId_PublisherDevice_id_fk" FOREIGN KEY ("deviceId") REFERENCES "public"."PublisherDevice"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PublisherDevice" ADD CONSTRAINT "PublisherDevice_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PublisherDevice" ADD CONSTRAINT "PublisherDevice_workspaceId_Workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StorageObject" ADD CONSTRAINT "StorageObject_workspaceId_Workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StorageObject" ADD CONSTRAINT "StorageObject_articleId_DeckProject_id_fk" FOREIGN KEY ("articleId") REFERENCES "public"."DeckProject"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "UsageLedger" ADD CONSTRAINT "UsageLedger_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "UsageLedger" ADD CONSTRAINT "UsageLedger_workspaceId_Workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "UserQuota" ADD CONSTRAINT "UserQuota_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "UserQuota" ADD CONSTRAINT "UserQuota_updatedByUserId_user_id_fk" FOREIGN KEY ("updatedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_Workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "account_providerId_accountId_key" ON "account" USING btree ("providerId","accountId");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_key" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "session_expiresAt_idx" ON "session" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_key" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "user_status_role_idx" ON "user" USING btree ("status","role");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "verification_expiresAt_idx" ON "verification" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "AuditEvent_workspaceId_createdAt_idx" ON "AuditEvent" USING btree ("workspaceId","createdAt");--> statement-breakpoint
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent" USING btree ("actorUserId","createdAt");--> statement-breakpoint
CREATE INDEX "AuditEvent_eventType_createdAt_idx" ON "AuditEvent" USING btree ("eventType","createdAt");--> statement-breakpoint
CREATE INDEX "BinancePublicationDraft_workspaceId_updatedAt_idx" ON "BinancePublicationDraft" USING btree ("workspaceId","updatedAt");--> statement-breakpoint
CREATE INDEX "BinancePublicationDraft_articleId_revision_idx" ON "BinancePublicationDraft" USING btree ("articleId","revision");--> statement-breakpoint
CREATE INDEX "BinancePublicationDraft_status_expiresAt_idx" ON "BinancePublicationDraft" USING btree ("status","expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "BinancePublicationDraft_id_revision_key" ON "BinancePublicationDraft" USING btree ("id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "Invitation_email_status_idx" ON "Invitation" USING btree ("email","status");--> statement-breakpoint
CREATE INDEX "Invitation_status_expiresAt_idx" ON "Invitation" USING btree ("status","expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "PublishApproval_callbackTokenHash_key" ON "PublishApproval" USING btree ("callbackTokenHash");--> statement-breakpoint
CREATE INDEX "PublishApproval_commandId_state_idx" ON "PublishApproval" USING btree ("commandId","state");--> statement-breakpoint
CREATE INDEX "PublishApproval_userId_state_idx" ON "PublishApproval" USING btree ("userId","state");--> statement-breakpoint
CREATE INDEX "PublishApproval_state_expiresAt_idx" ON "PublishApproval" USING btree ("state","expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "PublisherCommand_idempotencyKey_key" ON "PublisherCommand" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE INDEX "PublisherCommand_deviceId_state_createdAt_idx" ON "PublisherCommand" USING btree ("deviceId","state","createdAt");--> statement-breakpoint
CREATE INDEX "PublisherCommand_draftId_revision_idx" ON "PublisherCommand" USING btree ("draftId","revision");--> statement-breakpoint
CREATE INDEX "PublisherCommand_state_expiresAt_idx" ON "PublisherCommand" USING btree ("state","expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "PublisherDevice_tokenHash_key" ON "PublisherDevice" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "PublisherDevice_userId_status_idx" ON "PublisherDevice" USING btree ("userId","status");--> statement-breakpoint
CREATE INDEX "PublisherDevice_workspaceId_status_idx" ON "PublisherDevice" USING btree ("workspaceId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "StorageObject_r2Key_key" ON "StorageObject" USING btree ("r2Key");--> statement-breakpoint
CREATE INDEX "StorageObject_workspaceId_articleId_idx" ON "StorageObject" USING btree ("workspaceId","articleId");--> statement-breakpoint
CREATE INDEX "StorageObject_workspaceId_deletedAt_idx" ON "StorageObject" USING btree ("workspaceId","deletedAt");--> statement-breakpoint
CREATE INDEX "TelegramUpdate_createdAt_idx" ON "TelegramUpdate" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "TelegramUpdate_telegramUserId_createdAt_idx" ON "TelegramUpdate" USING btree ("telegramUserId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "UsageLedger_idempotencyKey_key" ON "UsageLedger" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE INDEX "UsageLedger_userId_period_kind_status_idx" ON "UsageLedger" USING btree ("userId","period","kind","status");--> statement-breakpoint
CREATE INDEX "UsageLedger_workspaceId_createdAt_idx" ON "UsageLedger" USING btree ("workspaceId","createdAt");--> statement-breakpoint
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember" USING btree ("userId");