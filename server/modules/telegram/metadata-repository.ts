import type { AppDatabase } from '@/server/db/client';

import type { TelegramMetadataRepository } from '@/workers/telegram/bot';

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

export function createTelegramMetadataRepository(
  database: AppDatabase,
): TelegramMetadataRepository {
  return {
    async listArticles(userId) {
      const rows = await database.$client`
        SELECT project."id", project."title", project."status", project."updatedAt"
        FROM "WorkspaceMember" member
        INNER JOIN "DeckProject" project ON project."workspaceId" = member."workspaceId"
        WHERE member."userId" = ${userId}
        ORDER BY project."updatedAt" DESC
        LIMIT 10
      `;
      return rows.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        status: String(row.status),
        updatedAt: asDate(row.updatedAt),
      }));
    },

    async listStatuses(userId) {
      const rows = await database.$client`
        SELECT status."id", status."kind", status."status", status."progress",
          status."errorCode", status."updatedAt"
        FROM (
          SELECT job."id", job."kind"::text AS "kind", job."status"::text AS "status",
            job."progress" AS "progress", job."errorCode", job."updatedAt"
          FROM "WorkspaceMember" member
          INNER JOIN "JobRun" job ON job."workspaceId" = member."workspaceId"
          WHERE member."userId" = ${userId}
          UNION ALL
          SELECT draft."id", 'binance_publication' AS "kind", draft."status"::text AS "status",
            NULL AS "progress", NULL AS "errorCode", draft."updatedAt"
          FROM "WorkspaceMember" member
          INNER JOIN "BinancePublicationDraft" draft ON draft."workspaceId" = member."workspaceId"
          WHERE member."userId" = ${userId}
        ) status
        ORDER BY status."updatedAt" DESC
        LIMIT 10
      `;
      return rows.map((row) => ({
        id: String(row.id),
        kind: String(row.kind),
        status: String(row.status),
        progress: row.progress === null || row.progress === undefined ? null : Number(row.progress),
        errorCode: row.errorCode ? String(row.errorCode) : null,
        updatedAt: asDate(row.updatedAt),
      }));
    },

    async listDevices(userId) {
      const rows = await database.$client`
        SELECT "id", "name", "status", "protocolVersion", "pairedAt", "lastSeenAt"
        FROM "PublisherDevice"
        WHERE "userId" = ${userId}
        ORDER BY "updatedAt" DESC
        LIMIT 10
      `;
      return rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        status: String(row.status),
        protocolVersion: Number(row.protocolVersion),
        pairedAt: row.pairedAt ? asDate(row.pairedAt) : null,
        lastSeenAt: row.lastSeenAt ? asDate(row.lastSeenAt) : null,
      }));
    },

    async getAdminOverview(userId) {
      const rows = await database.$client`
        SELECT
          (SELECT COUNT(*)::int FROM "user" WHERE "status" = 'active'::"UserStatus") AS "activeUsers",
          (SELECT COUNT(*)::int FROM "Invitation" WHERE "status" = 'pending'::"InvitationStatus") AS "pendingInvitations",
          (SELECT COUNT(*)::int FROM "PublisherDevice" WHERE "status" = 'active'::"PublisherDeviceStatus") AS "activeDevices"
        FROM "user" actor
        WHERE actor."id" = ${userId}
          AND actor."status" = 'active'::"UserStatus"
          AND actor."role" = 'owner'::"UserRole"
      `;
      const row = rows[0];
      if (!row) throw new Error('Owner access is required.');
      return {
        activeUsers: Number(row.activeUsers),
        pendingInvitations: Number(row.pendingInvitations),
        activeDevices: Number(row.activeDevices),
      };
    },
  };
}
