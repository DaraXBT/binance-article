CREATE TYPE "public"."AiCredentialProvider" AS ENUM('gemini');--> statement-breakpoint
CREATE TABLE "WorkspaceAiCredential" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"provider" "AiCredentialProvider" NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"encryptionKeyId" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"createdByUserId" text,
	"updatedByUserId" text,
	"validatedAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "WorkspaceAiCredential_ciphertext_base64url_check" CHECK ("WorkspaceAiCredential"."ciphertext" ~ '^[A-Za-z0-9_-]{24,2048}$'),
	CONSTRAINT "WorkspaceAiCredential_ciphertext_base64url_length_check" CHECK (char_length("WorkspaceAiCredential"."ciphertext") % 4 <> 1),
	CONSTRAINT "WorkspaceAiCredential_nonce_base64url_check" CHECK ("WorkspaceAiCredential"."nonce" ~ '^[A-Za-z0-9_-]{16}$'),
	CONSTRAINT "WorkspaceAiCredential_encryptionKeyId_check" CHECK ("WorkspaceAiCredential"."encryptionKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "WorkspaceAiCredential" ADD CONSTRAINT "WorkspaceAiCredential_workspaceId_Workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WorkspaceAiCredential" ADD CONSTRAINT "WorkspaceAiCredential_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WorkspaceAiCredential" ADD CONSTRAINT "WorkspaceAiCredential_updatedByUserId_user_id_fk" FOREIGN KEY ("updatedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "WorkspaceAiCredential_workspaceId_provider_key" ON "WorkspaceAiCredential" USING btree ("workspaceId","provider");--> statement-breakpoint
CREATE INDEX "WorkspaceAiCredential_workspaceId_updatedAt_idx" ON "WorkspaceAiCredential" USING btree ("workspaceId","updatedAt");
