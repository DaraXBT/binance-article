import { and, eq } from 'drizzle-orm';

import type { AppDatabase } from '@/server/db/client';
import { deckProject, workspaceMember } from '@/server/db/schema';

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
