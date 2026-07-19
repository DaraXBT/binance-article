import { getRuntimeDatabase } from '@/server/db/runtime';
import { requireArticleWorkspace } from '@/server/modules/workspace/membership';

import { requireActiveUser } from './authorization';

export async function authorizeArticleRequest(request: Request, articleId: string) {
  const actor = await requireActiveUser(request);
  const database = getRuntimeDatabase();
  const workspaceId = await requireArticleWorkspace(database, actor.id, articleId);
  return { actor, database, workspaceId };
}
