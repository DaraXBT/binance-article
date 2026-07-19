CREATE UNIQUE INDEX "PublishApproval_commandId_open_key" ON "PublishApproval" USING btree ("commandId") WHERE "state" IN ('pending', 'confirmation_required');--> statement-breakpoint
ALTER TABLE "PublishApproval" ADD CONSTRAINT "PublishApproval_revision_positive_check" CHECK ("revision" > 0);--> statement-breakpoint
ALTER TABLE "PublishApproval" ADD CONSTRAINT "PublishApproval_expiry_after_creation_check" CHECK ("expiresAt" > "createdAt");
