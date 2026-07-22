import type { AppDatabase } from '@/server/db/client';

import type {
  PublisherDeviceListItem,
  PublisherDeviceRepository,
  PublisherDeviceRecord,
  PublisherDeviceStatus,
} from './service';

function readDevice(row: Record<string, unknown> | undefined): PublisherDeviceRecord | null {
  if (!row || typeof row.id !== 'string' || typeof row.protocolVersion !== 'number') return null;
  return row as unknown as PublisherDeviceRecord;
}

function readListedDevice(row: Record<string, unknown>): PublisherDeviceListItem {
  const status = row.status as PublisherDeviceStatus;
  const lastSeenAt = row.lastSeenAt === null || row.lastSeenAt === undefined
    ? null
    : row.lastSeenAt instanceof Date
      ? row.lastSeenAt
      : new Date(String(row.lastSeenAt));
  if (
    typeof row.id !== 'string'
    || typeof row.name !== 'string'
    || !['pending', 'active', 'revoked'].includes(status)
    || typeof row.protocolVersion !== 'number'
    || (lastSeenAt !== null && Number.isNaN(lastSeenAt.getTime()))
  ) {
    throw new TypeError('Publisher device row is invalid.');
  }
  return {
    id: row.id,
    name: row.name,
    status,
    protocolVersion: row.protocolVersion,
    lastSeenAt,
  };
}

export function createPublisherDeviceRepository(
  database: AppDatabase,
): PublisherDeviceRepository {
  return {
    async createPending(input) {
      const rows = await database.$client`
        INSERT INTO "PublisherDevice" (
          "id", "userId", "workspaceId", "name", "tokenHash", "tokenPrefix",
          "status", "protocolVersion", "createdAt", "updatedAt"
        )
        SELECT
          ${input.id}, ${input.userId}, ${input.workspaceId}, ${input.name},
          ${input.tokenHash}, ${input.tokenPrefix}, 'pending'::"PublisherDeviceStatus", 1,
          ${input.now}, ${input.now}
        WHERE EXISTS (
          SELECT 1 FROM "user" AS actor
          WHERE actor."id" = ${input.userId}
            AND actor."status" = 'active'::"UserStatus"
        )
          AND EXISTS (
            SELECT 1 FROM "WorkspaceMember" AS member
            WHERE member."userId" = ${input.userId}
              AND member."workspaceId" = ${input.workspaceId}
          )
        RETURNING "id"
      `;
      const row = (rows as Array<Record<string, unknown>>)[0];
      return typeof row?.id === 'string' ? { id: row.id } : null;
    },

    async activatePending(input) {
      const rows = await database.$client`
        UPDATE "PublisherDevice" AS device
        SET "tokenHash" = ${input.deviceTokenHash},
            "tokenPrefix" = ${input.deviceTokenPrefix},
            "status" = 'active'::"PublisherDeviceStatus",
            "pairedAt" = ${input.now},
            "lastSeenAt" = ${input.now},
            "updatedAt" = ${input.now}
        WHERE device."tokenHash" = ${input.pairingHash}
          AND device."status" = 'pending'::"PublisherDeviceStatus"
          AND device."createdAt" > ${input.notBefore}
          AND EXISTS (
            SELECT 1 FROM "user" AS actor
            WHERE actor."id" = device."userId"
              AND actor."status" = 'active'::"UserStatus"
          )
          AND EXISTS (
            SELECT 1 FROM "WorkspaceMember" AS member
            WHERE member."userId" = device."userId"
              AND member."workspaceId" = device."workspaceId"
          )
        RETURNING
          device."id", device."userId", device."workspaceId", device."name",
          device."status", device."protocolVersion"
      `;
      return readDevice((rows as Array<Record<string, unknown>>)[0]);
    },

    async authenticate({ tokenHash, now }) {
      const rows = await database.$client`
        UPDATE "PublisherDevice" AS device
        SET "lastSeenAt" = ${now},
            "updatedAt" = ${now}
        WHERE device."tokenHash" = ${tokenHash}
          AND device."status" = 'active'::"PublisherDeviceStatus"
          AND EXISTS (
            SELECT 1 FROM "user" AS actor
            WHERE actor."id" = device."userId"
              AND actor."status" = 'active'::"UserStatus"
          )
          AND EXISTS (
            SELECT 1 FROM "WorkspaceMember" AS member
            WHERE member."userId" = device."userId"
              AND member."workspaceId" = device."workspaceId"
          )
        RETURNING
          device."id", device."userId", device."workspaceId", device."name",
          device."status", device."protocolVersion"
      `;
      return readDevice((rows as Array<Record<string, unknown>>)[0]);
    },

    async listForUserWorkspace({ actorUserId, workspaceId }) {
      const rows = await database.$client`
        SELECT
          device."id", device."name", device."status",
          device."protocolVersion", device."lastSeenAt"
        FROM "PublisherDevice" AS device
        WHERE device."userId" = ${actorUserId}
          AND device."workspaceId" = ${workspaceId}
          AND EXISTS (
            SELECT 1 FROM "user" AS actor
            WHERE actor."id" = ${actorUserId}
              AND actor."status" = 'active'::"UserStatus"
          )
          AND EXISTS (
            SELECT 1 FROM "WorkspaceMember" AS member
            WHERE member."userId" = ${actorUserId}
              AND member."workspaceId" = ${workspaceId}
          )
        ORDER BY
          CASE device."status"
            WHEN 'active'::"PublisherDeviceStatus" THEN 0
            WHEN 'pending'::"PublisherDeviceStatus" THEN 1
            ELSE 2
          END,
          device."updatedAt" DESC
      `;
      return (rows as Array<Record<string, unknown>>).map(readListedDevice);
    },

    async revokeForUserWorkspace({ actorUserId, workspaceId, deviceId, now }) {
      const rows = await database.$client`
        UPDATE "PublisherDevice" AS device
        SET "status" = 'revoked'::"PublisherDeviceStatus",
            "revokedAt" = ${now},
            "updatedAt" = ${now}
        WHERE device."id" = ${deviceId}
          AND device."userId" = ${actorUserId}
          AND device."workspaceId" = ${workspaceId}
          AND device."status" IN ('pending', 'active')
          AND EXISTS (
            SELECT 1 FROM "user" AS actor
            WHERE actor."id" = ${actorUserId}
              AND actor."status" = 'active'::"UserStatus"
          )
          AND EXISTS (
            SELECT 1 FROM "WorkspaceMember" AS member
            WHERE member."userId" = ${actorUserId}
              AND member."workspaceId" = ${workspaceId}
          )
        RETURNING device."id"
      `;
      return typeof (rows as Array<Record<string, unknown>>)[0]?.id === 'string';
    },
  };
}
