import { and, eq } from 'drizzle-orm';

import type { AppDatabase } from '@/server/db/client';
import { deckProject, workspace, workspaceMember } from '@/server/db/schema';
import { AppError } from '@/server/http/errors';

export interface ActorWorkspace {
  id: string;
  accessKeyPrefix: string;
}

function notFound(code: 'WORKSPACE_NOT_FOUND' | 'ARTICLE_NOT_FOUND', message: string): AppError {
  return new AppError({ code, message, status: 404 });
}

export async function resolveActorWorkspace(
  database: AppDatabase,
  actorUserId: string,
): Promise<ActorWorkspace | null> {
  const rows = await database
    .select({ id: workspace.id, accessKeyPrefix: workspace.accessKeyPrefix })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
    .where(eq(workspaceMember.userId, actorUserId))
    .limit(2);
  if (rows.length > 1) {
    throw new AppError({
      code: 'WORKSPACE_MEMBERSHIP_CONFLICT',
      message: 'The account workspace configuration is invalid.',
      status: 409,
    });
  }
  return rows[0] ?? null;
}

export async function requireActorWorkspace(
  database: AppDatabase,
  actorUserId: string,
): Promise<ActorWorkspace> {
  const resolved = await resolveActorWorkspace(database, actorUserId);
  if (!resolved) throw notFound('WORKSPACE_NOT_FOUND', 'Workspace not found.');
  return resolved;
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
