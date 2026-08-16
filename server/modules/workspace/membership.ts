import { and, eq, sql } from 'drizzle-orm';

import type { AppDatabase } from '@/server/db/client';
import { deckProject, workspace, workspaceMember } from '@/server/db/schema';
import { AppError } from '@/server/http/errors';

export interface ActorWorkspace {
  id: string;
  accessKeyPrefix: string;
  origin: 'legacy' | 'account';
  workspaceRole: 'owner' | 'member';
  canReplaceWithLegacy: boolean;
}

function notFound(code: 'WORKSPACE_NOT_FOUND' | 'ARTICLE_NOT_FOUND', message: string): AppError {
  return new AppError({ code, message, status: 404 });
}

export async function resolveActorWorkspace(
  database: AppDatabase,
  actorUserId: string,
): Promise<ActorWorkspace | null> {
  const rows = await database
    .select({
      id: workspace.id,
      accessKeyPrefix: workspace.accessKeyPrefix,
      origin: workspace.origin,
      workspaceRole: workspaceMember.role,
      canReplaceWithLegacy: sql<boolean>`
        ${workspace.origin} = 'account'::"WorkspaceOrigin"
        AND ${workspace.accessKeyPrefix} ~ '^acct_[a-f0-9]{8}$'
        AND ${workspace.legacyClaimExpiresAt} IS NULL
        AND EXISTS (
          SELECT 1 FROM "WorkspaceMember" AS actor_member
          WHERE actor_member."workspaceId" = ${workspace.id}
            AND actor_member."userId" = ${actorUserId}
            AND actor_member."role" = 'owner'::"WorkspaceMemberRole"
            AND actor_member."legacyClaimedAt" IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM "WorkspaceMember" AS other_member
          WHERE other_member."workspaceId" = ${workspace.id}
            AND other_member."userId" <> ${actorUserId}
        )
        AND NOT EXISTS (SELECT 1 FROM "WorkspaceSession" WHERE "workspaceId" = ${workspace.id})
        AND NOT EXISTS (SELECT 1 FROM "DeckProject" WHERE "workspaceId" = ${workspace.id})
        AND NOT EXISTS (SELECT 1 FROM "JobRun" WHERE "workspaceId" = ${workspace.id})
        AND NOT EXISTS (SELECT 1 FROM "UsageLedger" WHERE "workspaceId" = ${workspace.id})
        AND NOT EXISTS (SELECT 1 FROM "StorageObject" WHERE "workspaceId" = ${workspace.id})
        AND NOT EXISTS (SELECT 1 FROM "BinancePublicationDraft" WHERE "workspaceId" = ${workspace.id})
        AND NOT EXISTS (SELECT 1 FROM "PublicationDraft" WHERE "workspaceId" = ${workspace.id})
        AND NOT EXISTS (SELECT 1 FROM "ArticleCover" WHERE "workspaceId" = ${workspace.id})
        AND NOT EXISTS (SELECT 1 FROM "PublisherDevice" WHERE "workspaceId" = ${workspace.id})
        AND NOT EXISTS (SELECT 1 FROM "WorkspaceAiCredential" WHERE "workspaceId" = ${workspace.id})
      `.as('canReplaceWithLegacy'),
    })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
    .where(eq(workspaceMember.userId, actorUserId))
    .limit(2);
  if (rows.length > 1) {
    throw new AppError({
      code: 'WORKSPACE_MEMBERSHIP_CONFLICT',
      message: 'The account data configuration is invalid.',
      status: 409,
    });
  }
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    accessKeyPrefix: row.accessKeyPrefix,
    origin: row.origin,
    workspaceRole: row.workspaceRole,
    canReplaceWithLegacy: Boolean(row.canReplaceWithLegacy),
  };
}

export async function requireActorWorkspace(
  database: AppDatabase,
  actorUserId: string,
): Promise<ActorWorkspace> {
  const resolved = await resolveActorWorkspace(database, actorUserId);
  if (!resolved) throw notFound('WORKSPACE_NOT_FOUND', 'Account library not found.');
  return resolved;
}

export async function requireActorWorkspaceOwner(
  database: AppDatabase,
  actorUserId: string,
): Promise<ActorWorkspace & { workspaceRole: 'owner' }> {
  const resolved = await requireActorWorkspace(database, actorUserId);
  if (resolved.workspaceRole !== 'owner') {
    throw new AppError({
      code: 'WORKSPACE_OWNER_REQUIRED',
      message: 'This account cannot manage these settings.',
      status: 403,
    });
  }
  return { ...resolved, workspaceRole: 'owner' };
}

export async function resolveArticleWorkspace(
  database: AppDatabase,
  actorUserId: string,
  articleId: string,
): Promise<string | null> {
  const rows = await database
    .select({ workspaceId: deckProject.workspaceId })
    .from(deckProject)
    .innerJoin(workspaceMember, and(
      eq(workspaceMember.workspaceId, deckProject.workspaceId),
      eq(workspaceMember.userId, actorUserId),
    ))
    .where(eq(deckProject.id, articleId))
    .limit(1);
  return rows[0]?.workspaceId ?? null;
}

export async function requireArticleWorkspace(
  database: AppDatabase,
  actorUserId: string,
  articleId: string,
): Promise<string> {
  const workspaceId = await resolveArticleWorkspace(database, actorUserId, articleId);
  if (!workspaceId) throw notFound('ARTICLE_NOT_FOUND', 'Article not found.');
  return workspaceId;
}
