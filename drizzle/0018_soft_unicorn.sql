ALTER TABLE "WorkspaceAiCredential" DROP CONSTRAINT "WorkspaceAiCredential_ciphertext_base64url_check";--> statement-breakpoint
ALTER TABLE "WorkspaceAiCredential" ADD CONSTRAINT "WorkspaceAiCredential_ciphertext_base64url_check" CHECK ("WorkspaceAiCredential"."ciphertext" ~ '^[A-Za-z0-9_-]+$'
      AND char_length("WorkspaceAiCredential"."ciphertext") BETWEEN 24 AND 2048);