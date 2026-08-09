CREATE TYPE "public"."EnrollmentClaimSource" AS ENUM('shared_code', 'legacy_invitation', 'bootstrap');--> statement-breakpoint
CREATE TYPE "public"."EnrollmentClaimStatus" AS ENUM('pending', 'reserved', 'completed', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."EnrollmentCodeStatus" AS ENUM('active', 'revoked');--> statement-breakpoint
ALTER TYPE "public"."UserStatus" RENAME TO "UserStatus_legacy";--> statement-breakpoint
CREATE TYPE "public"."UserStatus" AS ENUM('pending', 'active', 'suspended', 'revoked');--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "status" TYPE "public"."UserStatus" USING "status"::text::"public"."UserStatus";--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
DROP TYPE "public"."UserStatus_legacy";--> statement-breakpoint
CREATE TABLE "EnrollmentClaim" (
	"id" text PRIMARY KEY NOT NULL,
	"tokenHash" text NOT NULL,
	"tokenPrefix" text NOT NULL,
	"codeId" text,
	"codeVersion" integer,
	"source" "EnrollmentClaimSource" NOT NULL,
	"sourceReferenceId" text,
	"status" "EnrollmentClaimStatus" DEFAULT 'pending' NOT NULL,
	"email" text,
	"userId" text,
	"idempotencyKeyHash" text,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"reservationExpiresAt" timestamp (3) with time zone,
	"completedAt" timestamp (3) with time zone,
	"revokedAt" timestamp (3) with time zone,
	"failureCode" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "EnrollmentClaim_tokenHash_sha256_check" CHECK ("EnrollmentClaim"."tokenHash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "EnrollmentClaim_tokenPrefix_check" CHECK ("EnrollmentClaim"."tokenPrefix" ~ '^[A-Za-z0-9_-]{8}$'),
	CONSTRAINT "EnrollmentClaim_idempotencyKeyHash_check" CHECK ("EnrollmentClaim"."idempotencyKeyHash" IS NULL OR "EnrollmentClaim"."idempotencyKeyHash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "EnrollmentClaim_codeVersion_positive_check" CHECK ("EnrollmentClaim"."codeVersion" IS NULL OR "EnrollmentClaim"."codeVersion" > 0),
	CONSTRAINT "EnrollmentClaim_source_binding_check" CHECK ((
      "EnrollmentClaim"."source" = 'shared_code'
      AND "EnrollmentClaim"."codeId" IS NOT NULL
      AND "EnrollmentClaim"."codeVersion" IS NOT NULL
      AND "EnrollmentClaim"."sourceReferenceId" IS NULL
    ) OR (
      "EnrollmentClaim"."source" IN ('legacy_invitation', 'bootstrap')
      AND "EnrollmentClaim"."codeId" IS NULL
      AND "EnrollmentClaim"."codeVersion" IS NULL
      AND "EnrollmentClaim"."sourceReferenceId" IS NOT NULL
    )),
	CONSTRAINT "EnrollmentClaim_email_normalized_check" CHECK ("EnrollmentClaim"."email" IS NULL OR "EnrollmentClaim"."email" = lower(btrim("EnrollmentClaim"."email"))),
	CONSTRAINT "EnrollmentClaim_expiry_check" CHECK ("EnrollmentClaim"."expiresAt" > "EnrollmentClaim"."createdAt"),
	CONSTRAINT "EnrollmentClaim_reservation_expiry_check" CHECK ("EnrollmentClaim"."reservationExpiresAt" IS NULL OR (
      "EnrollmentClaim"."reservationExpiresAt" > "EnrollmentClaim"."updatedAt"
      AND "EnrollmentClaim"."reservationExpiresAt" <= "EnrollmentClaim"."expiresAt"
    )),
	CONSTRAINT "EnrollmentClaim_lifecycle_check" CHECK ((
      "EnrollmentClaim"."status" = 'pending'
      AND "EnrollmentClaim"."userId" IS NULL
      AND "EnrollmentClaim"."reservationExpiresAt" IS NULL
      AND "EnrollmentClaim"."completedAt" IS NULL
      AND "EnrollmentClaim"."revokedAt" IS NULL
    ) OR (
      "EnrollmentClaim"."status" = 'reserved'
      AND "EnrollmentClaim"."email" IS NOT NULL
      AND "EnrollmentClaim"."userId" IS NULL
      AND "EnrollmentClaim"."reservationExpiresAt" IS NOT NULL
      AND "EnrollmentClaim"."completedAt" IS NULL
      AND "EnrollmentClaim"."revokedAt" IS NULL
    ) OR (
      "EnrollmentClaim"."status" = 'completed'
      AND "EnrollmentClaim"."email" IS NOT NULL
      AND "EnrollmentClaim"."userId" IS NOT NULL
      AND "EnrollmentClaim"."reservationExpiresAt" IS NULL
      AND "EnrollmentClaim"."completedAt" IS NOT NULL
      AND "EnrollmentClaim"."revokedAt" IS NULL
    ) OR (
      "EnrollmentClaim"."status" = 'expired'
      AND "EnrollmentClaim"."userId" IS NULL
      AND "EnrollmentClaim"."reservationExpiresAt" IS NULL
      AND "EnrollmentClaim"."completedAt" IS NULL
      AND "EnrollmentClaim"."revokedAt" IS NULL
    ) OR (
      "EnrollmentClaim"."status" = 'revoked'
      AND "EnrollmentClaim"."userId" IS NULL
      AND "EnrollmentClaim"."reservationExpiresAt" IS NULL
      AND "EnrollmentClaim"."completedAt" IS NULL
      AND "EnrollmentClaim"."revokedAt" IS NOT NULL
    ))
);
--> statement-breakpoint
CREATE TABLE "EnrollmentCode" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"codeHash" text NOT NULL,
	"codePrefix" text NOT NULL,
	"status" "EnrollmentCodeStatus" DEFAULT 'active' NOT NULL,
	"createdByUserId" text,
	"revokedByUserId" text,
	"revokedAt" timestamp (3) with time zone,
	"revocationReason" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "EnrollmentCode_id_version_key" UNIQUE("id","version"),
	CONSTRAINT "EnrollmentCode_version_positive_check" CHECK ("EnrollmentCode"."version" > 0),
	CONSTRAINT "EnrollmentCode_codeHash_hmac_check" CHECK ("EnrollmentCode"."codeHash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "EnrollmentCode_codePrefix_crockford_check" CHECK ("EnrollmentCode"."codePrefix" ~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$'),
	CONSTRAINT "EnrollmentCode_lifecycle_check" CHECK ((
      "EnrollmentCode"."status" = 'active'
      AND "EnrollmentCode"."revokedAt" IS NULL
      AND "EnrollmentCode"."revokedByUserId" IS NULL
      AND "EnrollmentCode"."revocationReason" IS NULL
    ) OR (
      "EnrollmentCode"."status" = 'revoked'
      AND "EnrollmentCode"."revokedAt" IS NOT NULL
      AND "EnrollmentCode"."revocationReason" IS NOT NULL
    ))
);
--> statement-breakpoint
ALTER TABLE "EnrollmentClaim" ADD CONSTRAINT "EnrollmentClaim_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EnrollmentClaim" ADD CONSTRAINT "EnrollmentClaim_code_version_fkey" FOREIGN KEY ("codeId","codeVersion") REFERENCES "public"."EnrollmentCode"("id","version") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EnrollmentCode" ADD CONSTRAINT "EnrollmentCode_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EnrollmentCode" ADD CONSTRAINT "EnrollmentCode_revokedByUserId_user_id_fk" FOREIGN KEY ("revokedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "EnrollmentClaim_tokenHash_key" ON "EnrollmentClaim" USING btree ("tokenHash");--> statement-breakpoint
CREATE UNIQUE INDEX "EnrollmentClaim_idempotencyKeyHash_key" ON "EnrollmentClaim" USING btree ("idempotencyKeyHash") WHERE "EnrollmentClaim"."idempotencyKeyHash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "EnrollmentClaim_legacy_sourceReferenceId_key" ON "EnrollmentClaim" USING btree ("sourceReferenceId") WHERE "EnrollmentClaim"."source" IN ('legacy_invitation', 'bootstrap');--> statement-breakpoint
CREATE INDEX "EnrollmentClaim_codeId_status_idx" ON "EnrollmentClaim" USING btree ("codeId","status");--> statement-breakpoint
CREATE INDEX "EnrollmentClaim_status_expiresAt_idx" ON "EnrollmentClaim" USING btree ("status","expiresAt");--> statement-breakpoint
CREATE INDEX "EnrollmentClaim_status_reservationExpiresAt_idx" ON "EnrollmentClaim" USING btree ("status","reservationExpiresAt");--> statement-breakpoint
CREATE INDEX "EnrollmentClaim_email_status_idx" ON "EnrollmentClaim" USING btree ("email","status");--> statement-breakpoint
CREATE INDEX "EnrollmentClaim_userId_idx" ON "EnrollmentClaim" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "EnrollmentClaim_sourceReferenceId_idx" ON "EnrollmentClaim" USING btree ("sourceReferenceId");--> statement-breakpoint
CREATE UNIQUE INDEX "EnrollmentCode_version_key" ON "EnrollmentCode" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "EnrollmentCode_codeHash_key" ON "EnrollmentCode" USING btree ("codeHash");--> statement-breakpoint
CREATE UNIQUE INDEX "EnrollmentCode_one_active_key" ON "EnrollmentCode" USING btree ("status") WHERE "EnrollmentCode"."status" = 'active';--> statement-breakpoint
CREATE INDEX "EnrollmentCode_codePrefix_idx" ON "EnrollmentCode" USING btree ("codePrefix");--> statement-breakpoint
CREATE INDEX "EnrollmentCode_status_updatedAt_idx" ON "EnrollmentCode" USING btree ("status","updatedAt");
