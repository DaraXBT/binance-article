DROP INDEX "WorkspaceMember_userId_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "WorkspaceMember_userId_single_workspace_key" ON "WorkspaceMember" USING btree ("userId");