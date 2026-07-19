import type { AppDatabase } from '@/server/db/client';

import type { TelegramApprovalRepository } from './approval-service';

export function createTelegramApprovalRepository(
  database: AppDatabase,
): TelegramApprovalRepository {
  return {
    async requestConfirmation(input) {
      const rows = await database.$client`
        WITH candidate AS (
          SELECT
            command."id" AS "commandId",
            command."draftId",
            command."revision",
            command."recipeHash",
            command."expiresAt" AS "commandExpiresAt",
            draft."expiresAt" AS "draftExpiresAt"
          FROM "PublisherCommand" command
          INNER JOIN "BinancePublicationDraft" draft ON draft."id" = command."draftId"
          INNER JOIN "PublisherDevice" device ON device."id" = command."deviceId"
          INNER JOIN "account" linked_account
            ON linked_account."userId" = ${input.actorUserId}
            AND linked_account."providerId" = ${'telegram'}
            AND linked_account."accountId" = ${input.telegramUserId}
          WHERE command."id" = ${input.commandId}
            AND command."state" = 'awaiting_review'::"PublisherCommandState"
            AND command."expiresAt" > ${input.now}
            AND draft."status" = 'review_ready'::"PublicationDraftStatus"
            AND draft."revision" = command."revision"
            AND draft."recipeHash" = command."recipeHash"
            AND draft."expiresAt" > ${input.now}
            AND device."userId" = ${input.actorUserId}
            AND device."status" = 'active'::"PublisherDeviceStatus"
          FOR UPDATE OF command, draft
        ), updated_command AS (
          UPDATE "PublisherCommand" command
          SET "state" = 'awaiting_approval'::"PublisherCommandState", "updatedAt" = ${input.now}
          FROM candidate
          WHERE command."id" = candidate."commandId"
            AND command."state" = 'awaiting_review'::"PublisherCommandState"
          RETURNING command."id"
        ), updated_draft AS (
          UPDATE "BinancePublicationDraft" draft
          SET "status" = 'awaiting_approval'::"PublicationDraftStatus", "updatedAt" = ${input.now}
          FROM candidate, updated_command
          WHERE draft."id" = candidate."draftId"
            AND draft."status" = 'review_ready'::"PublicationDraftStatus"
          RETURNING draft."id"
        ), inserted_approval AS (
          INSERT INTO "PublishApproval" (
            "id", "commandId", "draftId", "userId", "telegramUserId",
            "callbackTokenHash", "state", "revision", "recipeHash",
            "expiresAt", "createdAt", "updatedAt"
          )
          SELECT
            ${input.approvalId}, candidate."commandId", candidate."draftId",
            ${input.actorUserId}, ${input.telegramUserId}, ${input.callbackTokenHash},
            'confirmation_required'::"PublishApprovalState", candidate."revision",
            candidate."recipeHash",
            LEAST(${input.requestedExpiresAt}, candidate."commandExpiresAt", candidate."draftExpiresAt"),
            ${input.now}, ${input.now}
          FROM candidate
          INNER JOIN updated_command ON true
          INNER JOIN updated_draft ON true
          RETURNING "commandId", "expiresAt"
        )
        SELECT "commandId", "expiresAt" FROM inserted_approval
      `;
      if (!rows[0]) return null;
      return {
        commandId: String(rows[0].commandId),
        expiresAt: rows[0].expiresAt instanceof Date
          ? rows[0].expiresAt
          : new Date(String(rows[0].expiresAt)),
      };
    },

    async confirm(input) {
      const rows = await database.$client`
        WITH candidate AS (
          SELECT approval."id" AS "approvalId", approval."commandId", approval."draftId"
          FROM "PublishApproval" approval
          INNER JOIN "PublisherCommand" command ON command."id" = approval."commandId"
          INNER JOIN "BinancePublicationDraft" draft ON draft."id" = approval."draftId"
          INNER JOIN "PublisherDevice" device ON device."id" = command."deviceId"
          INNER JOIN "account" linked_account
            ON linked_account."userId" = ${input.actorUserId}
            AND linked_account."providerId" = ${'telegram'}
            AND linked_account."accountId" = ${input.telegramUserId}
          WHERE approval."callbackTokenHash" = ${input.callbackTokenHash}
            AND approval."userId" = ${input.actorUserId}
            AND approval."telegramUserId" = ${input.telegramUserId}
            AND approval."state" = 'confirmation_required'::"PublishApprovalState"
            AND approval."expiresAt" > ${input.now}
            AND approval."revision" = command."revision"
            AND approval."recipeHash" = command."recipeHash"
            AND command."state" = 'awaiting_approval'::"PublisherCommandState"
            AND command."expiresAt" > ${input.now}
            AND approval."revision" = draft."revision"
            AND approval."recipeHash" = draft."recipeHash"
            AND draft."status" = 'awaiting_approval'::"PublicationDraftStatus"
            AND draft."expiresAt" > ${input.now}
            AND device."userId" = ${input.actorUserId}
            AND device."status" = 'active'::"PublisherDeviceStatus"
          FOR UPDATE OF approval, command, draft
        ), updated_approval AS (
          UPDATE "PublishApproval" approval
          SET "state" = 'approved'::"PublishApprovalState",
            "consumedAt" = ${input.now}, "updatedAt" = ${input.now}
          FROM candidate
          WHERE approval."id" = candidate."approvalId"
          RETURNING approval."commandId"
        ), updated_command AS (
          UPDATE "PublisherCommand" command
          SET "state" = 'approved'::"PublisherCommandState", "updatedAt" = ${input.now}
          FROM candidate, updated_approval
          WHERE command."id" = candidate."commandId"
          RETURNING command."id"
        ), updated_draft AS (
          UPDATE "BinancePublicationDraft" draft
          SET "status" = 'authorized'::"PublicationDraftStatus", "updatedAt" = ${input.now}
          FROM candidate, updated_command
          WHERE draft."id" = candidate."draftId"
          RETURNING draft."id"
        )
        SELECT updated_command."id" AS "commandId"
        FROM updated_command INNER JOIN updated_draft ON true
      `;
      return rows[0] ? { commandId: String(rows[0].commandId) } : null;
    },

    async expire(input) {
      const rows = await database.$client`
        WITH candidate AS (
          SELECT approval."id" AS "approvalId", approval."commandId", approval."draftId"
          FROM "PublishApproval" approval
          INNER JOIN "PublisherCommand" command ON command."id" = approval."commandId"
          INNER JOIN "BinancePublicationDraft" draft ON draft."id" = approval."draftId"
          INNER JOIN "PublisherDevice" device ON device."id" = command."deviceId"
          INNER JOIN "account" linked_account
            ON linked_account."userId" = ${input.actorUserId}
            AND linked_account."providerId" = ${'telegram'}
            AND linked_account."accountId" = ${input.telegramUserId}
          WHERE approval."callbackTokenHash" = ${input.callbackTokenHash}
            AND approval."userId" = ${input.actorUserId}
            AND approval."telegramUserId" = ${input.telegramUserId}
            AND approval."state" = 'confirmation_required'::"PublishApprovalState"
            AND approval."expiresAt" <= ${input.now}
            AND approval."revision" = command."revision"
            AND approval."recipeHash" = command."recipeHash"
            AND command."state" = 'awaiting_approval'::"PublisherCommandState"
            AND approval."revision" = draft."revision"
            AND approval."recipeHash" = draft."recipeHash"
            AND draft."status" = 'awaiting_approval'::"PublicationDraftStatus"
            AND device."userId" = ${input.actorUserId}
          FOR UPDATE OF approval, command, draft
        ), updated_approval AS (
          UPDATE "PublishApproval" approval
          SET "state" = 'expired'::"PublishApprovalState", "updatedAt" = ${input.now}
          FROM candidate
          WHERE approval."id" = candidate."approvalId"
          RETURNING approval."commandId"
        ), updated_command AS (
          UPDATE "PublisherCommand" command
          SET "state" = 'expired'::"PublisherCommandState",
            "completedAt" = ${input.now}, "updatedAt" = ${input.now}
          FROM candidate, updated_approval
          WHERE command."id" = candidate."commandId"
          RETURNING command."id"
        ), updated_draft AS (
          UPDATE "BinancePublicationDraft" draft
          SET "status" = 'expired'::"PublicationDraftStatus", "updatedAt" = ${input.now}
          FROM candidate, updated_command
          WHERE draft."id" = candidate."draftId"
          RETURNING draft."id"
        )
        SELECT updated_command."id" AS "commandId"
        FROM updated_command INNER JOIN updated_draft ON true
      `;
      return Boolean(rows[0]);
    },
  };
}
