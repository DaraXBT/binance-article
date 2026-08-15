import { and, eq } from 'drizzle-orm';

import type { AppDatabase } from '@/server/db/client';
import { publicationDraft, workspaceMember } from '@/server/db/schema';

import type { PublicationDraftRecord, PublicationDraftRepository } from './draft-service';

export function createPublicationDraftRepository(database: AppDatabase): PublicationDraftRepository {
  return {
    async getDraft({ actorUserId, workspaceId, articleId, target, kind }) {
      const rows = await database
        .select({
          id: publicationDraft.id,
          workspaceId: publicationDraft.workspaceId,
          articleId: publicationDraft.articleId,
          target: publicationDraft.target,
          kind: publicationDraft.kind,
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
          eq(publicationDraft.kind, kind),
        ))
        .limit(1);
      return (rows[0] as PublicationDraftRecord | undefined) ?? null;
    },

    async saveDraft(input) {
      const [rows] = await database.$client.transaction((transaction) => [
        transaction`
          INSERT INTO "PublicationDraft" (
            "id", "workspaceId", "articleId", "createdByUserId", "target", "kind", "version",
            "revision", "status", "payload", "expiresAt", "createdAt", "updatedAt"
          )
          SELECT
            ${input.draftId}, ${input.workspaceId}, ${input.articleId}, ${input.actorUserId},
            ${input.target}::"PublicationTarget", ${input.kind}::"PublicationKind",
            3, 1, 'draft'::"PublicationDraftStatus",
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
          ON CONFLICT ("workspaceId", "articleId", "target", "kind") DO UPDATE
          SET
            "revision" = "PublicationDraft"."revision" + 1,
            "version" = 3,
            "status" = 'draft'::"PublicationDraftStatus",
            "payload" = EXCLUDED."payload",
            "recipeHash" = NULL,
            "expiresAt" = EXCLUDED."expiresAt",
            "publishedUrl" = NULL,
            "updatedAt" = EXCLUDED."updatedAt"
          WHERE "PublicationDraft"."revision" = ${input.expectedRevision}
            AND (
              "PublicationDraft"."status" NOT IN (
                'queued'::"PublicationDraftStatus",
                'review_ready'::"PublicationDraftStatus",
                'awaiting_approval'::"PublicationDraftStatus",
                'authorized'::"PublicationDraftStatus",
                'publishing'::"PublicationDraftStatus"
              )
              -- Escape hatch: a draft queued for a device that died stays
              -- 'queued' forever; once the draft has expired it may be saved
              -- over. A stale command for it fails recipe validation on claim.
              OR (
                "PublicationDraft"."status" = 'queued'::"PublicationDraftStatus"
                AND "PublicationDraft"."expiresAt" <= ${input.now}
              )
            )
            AND EXISTS (
              SELECT 1 FROM "WorkspaceMember" member
              WHERE member."workspaceId" = "PublicationDraft"."workspaceId"
                AND member."userId" = ${input.actorUserId}
            )
          RETURNING
            "id", "workspaceId", "articleId", "target", "kind", "revision", "status", "payload",
            "expiresAt", "publishedUrl", "updatedAt"
        `,
      ], { isolationLevel: 'ReadCommitted' });
      return (rows[0] as PublicationDraftRecord | undefined) ?? null;
    },
  };
}
