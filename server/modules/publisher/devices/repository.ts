import { and, eq, gt } from 'drizzle-orm';

import type { AppDatabase } from '@/server/db/client';
import { publisherDevice } from '@/server/db/schema';

import type { PublisherDeviceRepository, PublisherDeviceRecord } from './service';

const deviceSelection = {
  id: publisherDevice.id,
  userId: publisherDevice.userId,
  workspaceId: publisherDevice.workspaceId,
  name: publisherDevice.name,
  status: publisherDevice.status,
  protocolVersion: publisherDevice.protocolVersion,
};

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
          SELECT 1 FROM "WorkspaceMember"
          WHERE "workspaceId" = ${input.workspaceId} AND "userId" = ${input.userId}
        )
        RETURNING "id"
      `;
      return rows[0] ? { id: String(rows[0].id) } : null;
    },

    async activatePending(input) {
      const rows = await database
        .update(publisherDevice)
        .set({
          tokenHash: input.deviceTokenHash,
          tokenPrefix: input.deviceTokenPrefix,
          status: 'active',
          pairedAt: input.now,
          lastSeenAt: input.now,
          updatedAt: input.now,
        })
        .where(and(
          eq(publisherDevice.tokenHash, input.pairingHash),
          eq(publisherDevice.status, 'pending'),
          gt(publisherDevice.createdAt, input.notBefore),
        ))
        .returning(deviceSelection);
      return (rows[0] as PublisherDeviceRecord | undefined) ?? null;
    },

    async authenticate({ tokenHash, now }) {
      const rows = await database
        .update(publisherDevice)
        .set({ lastSeenAt: now, updatedAt: now })
        .where(and(
          eq(publisherDevice.tokenHash, tokenHash),
          eq(publisherDevice.status, 'active'),
        ))
        .returning(deviceSelection);
      return (rows[0] as PublisherDeviceRecord | undefined) ?? null;
    },
  };
}
