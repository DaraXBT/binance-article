import type { AppDatabase } from '@/server/db/client';

import type { TelegramUpdateRepository } from './update-service';

export function createTelegramUpdateRepository(database: AppDatabase): TelegramUpdateRepository {
  return {
    async claimUpdate(input) {
      const rows = await database.$client`
        WITH claimed AS (
          INSERT INTO "TelegramUpdate" (
            "botId", "updateId", "telegramUserId", "payloadHash", "status", "createdAt"
          ) VALUES (
            ${input.botId}, ${input.updateId}, ${input.telegramUserId}, ${input.payloadHash},
            'processing'::"TelegramUpdateStatus", ${input.now}
          )
          ON CONFLICT ("botId", "updateId") DO NOTHING
          RETURNING "payloadHash"
        )
        SELECT
          TRUE AS "claimed",
          claimed."payloadHash" AS "payloadHash",
          usr."id" AS "userId",
          usr."name" AS "name",
          usr."status" AS "status",
          usr."role" AS "role"
        FROM claimed
        LEFT JOIN "account" acct
          ON acct."providerId" = ${'telegram'}
          AND acct."accountId" = ${input.telegramUserId}
        LEFT JOIN "user" usr ON usr."id" = acct."userId"
        UNION ALL
        SELECT
          FALSE AS "claimed",
          existing."payloadHash" AS "payloadHash",
          NULL AS "userId",
          NULL AS "name",
          NULL AS "status",
          NULL AS "role"
        FROM "TelegramUpdate" existing
        WHERE existing."botId" = ${input.botId}
          AND existing."updateId" = ${input.updateId}
          AND NOT EXISTS (SELECT 1 FROM claimed)
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) throw new Error('Telegram update claim failed.');
      if (!row.claimed) {
        return String(row.payloadHash) === input.payloadHash
          ? { kind: 'duplicate' }
          : { kind: 'replay_anomaly' };
      }
      const actor = row.userId && row.name && row.status && row.role && input.telegramUserId
        ? {
          id: String(row.userId),
          name: String(row.name),
          status: row.status as 'active' | 'suspended' | 'revoked',
          role: row.role as 'owner' | 'user',
          telegramUserId: input.telegramUserId,
        }
        : null;
      return { kind: 'claimed', actor };
    },

    async completeUpdate(input) {
      const rows = await database.$client`
        UPDATE "TelegramUpdate"
        SET
          "status" = ${input.status}::"TelegramUpdateStatus",
          "errorCode" = ${input.errorCode},
          "processedAt" = ${input.now}
        WHERE "botId" = ${input.botId}
          AND "updateId" = ${input.updateId}
          AND "status" = 'processing'::"TelegramUpdateStatus"
        RETURNING "botId"
      `;
      return Boolean(rows[0]);
    },
  };
}
