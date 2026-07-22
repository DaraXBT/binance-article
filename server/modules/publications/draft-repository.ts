import { and, eq } from 'drizzle-orm';

import type { AppDatabase } from '@/server/db/client';
import { publicationDraft, workspaceMember } from '@/server/db/schema';

import type { PublicationDraftRecord, PublicationDraftRepository } from './draft-service';

export function createPublicationDraftRepository(database: AppDatabase): PublicationDraftRepository {
  return {
    async getDraft({ actorUserId, workspaceId, articleId, target }) {
      const rows = await database
        .select({
          id: publicationDraft.id,
          workspaceId: publicationDraft.workspaceId,
          articleId: publicationDraft.articleId,
          target: publicationDraft.target,
          revision: publicationDraft.revision,
          status: publicationDraft.status,
          payload: publicationDraft.payload,
          expiresAt: publicationDraft.expiresAt,
          publishedUrl: publicationDraft.publishedUrl,
          updatedAt: publicationDraft.updatedAt,
        })
        .from(publicationDraft)
        .innerJoin(workspaceMember, and(
          eq(workspaceMember.workspaceId, publicationDraft.workspaceId),
          eq(workspaceMember.userId, actorUserId),
        ))
        .where(and(
          eq(publicationDraft.workspaceId, workspaceId),
          eq(publicationDraft.articleId, articleId),
          eq(publicationDraft.target, target),
        ))
        .limit(1);
      return (rows[0] as PublicationDraftRecord | undefined) ?? null;
    },

    async saveDraft(input) {
      const [rows] = await database.$client.transaction((transaction) => [
        transaction`
          INSERT INTO "PublicationDraft" (
            "id", "workspaceId", "articleId", "createdByUserId", "target", "version",
            "revision", "status", "payload", "expiresAt", "createdAt", "updatedAt"
          )
          SELECT
            ${input.draftId}, ${input.workspaceId}, ${input.articleId}, ${input.actorUserId},
            ${input.target}::"PublicationTarget", 2, 1, 'draft'::"PublicationDraftStatus",
            ${JSON.stringify(input.payload)}::jsonb, ${input.expiresAt}, ${input.now}, ${input.now}
          FROM "DeckProject" article
          WHERE article."id" = ${input.articleId}
            AND article."workspaceId" = ${input.workspaceId}
            AND ${input.expectedRevision} = 0
            AND EXISTS (
              SELECT 1 FROM "WorkspaceMember" member
              WHERE member."workspaceId" = article."workspaceId"
                AND member."userId" = ${input.actorUserId}
            )
          ON CONFLICT ("workspaceId", "articleId", "target") DO UPDATE
          SET
            "revision" = "PublicationDraft"."revision" + 1,
            "status" = 'draft'::"PublicationDraftStatus",
            "payload" = EXCLUDED."payload",
            "recipeHash" = NULL,
            "expiresAt" = EXCLUDED."expiresAt",
            "publishedUrl" = NULL,
            "updatedAt" = EXCLUDED."updatedAt"
          WHERE "PublicationDraft"."revision" = ${input.expectedRevision}
            AND "PublicationDraft"."status" NOT IN (
              'queued'::"PublicationDraftStatus",
              'review_ready'::"PublicationDraftStatus",
              'awaiting_approval'::"PublicationDraftStatus",
              'authorized'::"PublicationDraftStatus",
              'publishing'::"PublicationDraftStatus"
            )
            AND EXISTS (
              SELECT 1 FROM "WorkspaceMember" member
              WHERE member."workspaceId" = "PublicationDraft"."workspaceId"
                AND member."userId" = ${input.actorUserId}
            )
          RETURNING
            "id", "workspaceId", "articleId", "target", "revision", "status", "payload",
            "expiresAt", "publishedUrl", "updatedAt"
        `,
      ], { isolationLevel: 'ReadCommitted' });
      return (rows[0] as PublicationDraftRecord | undefined) ?? null;
    },
  };
}
