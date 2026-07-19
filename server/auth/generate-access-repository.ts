import type { AppDatabase } from '@/server/db/client';

export type GenerationAccessGrantStatus = 'active' | 'consumed' | 'revoked';

export interface GenerationAccessGrantRecord {
  id: string;
  status: GenerationAccessGrantStatus;
  boundWorkspaceId: string | null;
  boundSessionId: string | null;
  envCodeHash: string;
}

export interface GenerationAccessGrantRepository {
  findById(grantId: string): Promise<GenerationAccessGrantRecord | null>;
  findByCodeHash(codeHash: string): Promise<GenerationAccessGrantRecord | null>;
  consumeUnbound(input: {
    grantId: string;
    workspaceId: string;
    sessionId: string;
    envCodeHash: string;
    now: Date;
  }): Promise<boolean>;
}

function readGrantRow(row: unknown): GenerationAccessGrantRecord | null {
  if (row === undefined) return null;
  if (!row || typeof row !== 'object') {
    throw new Error('Generation access grant query returned invalid data.');
  }
  const value = row as Record<string, unknown>;
  const status = value.status;
  if (
    typeof value.id !== 'string' ||
    (status !== 'active' && status !== 'consumed' && status !== 'revoked') ||
    (value.boundWorkspaceId !== null && typeof value.boundWorkspaceId !== 'string') ||
    (value.boundSessionId !== null && typeof value.boundSessionId !== 'string') ||
    typeof value.envCodeHash !== 'string'
  ) {
    throw new Error('Generation access grant query returned invalid data.');
  }
  return {
    id: value.id,
    status,
    boundWorkspaceId: value.boundWorkspaceId,
    boundSessionId: value.boundSessionId,
    envCodeHash: value.envCodeHash,
  };
}

function firstGrant(rows: unknown): GenerationAccessGrantRecord | null {
  if (!Array.isArray(rows)) {
    throw new Error('Generation access grant query returned invalid data.');
  }
  return readGrantRow(rows[0]);
}

export function createGenerationAccessGrantRepository(
  database: AppDatabase,
): GenerationAccessGrantRepository {
  return {
    async findById(grantId) {
      const rows = await database.$client`
        SELECT
          "id", "status", "boundWorkspaceId", "boundSessionId", "envCodeHash"
        FROM "GenerationAccessGrant"
        WHERE "id" = ${grantId}
        LIMIT 1
      `;
      return firstGrant(rows);
    },

    async findByCodeHash(codeHash) {
      const rows = await database.$client`
        SELECT
          "id", "status", "boundWorkspaceId", "boundSessionId", "envCodeHash"
        FROM "GenerationAccessGrant"
        WHERE "codeHash" = ${codeHash}
        LIMIT 1
      `;
      return firstGrant(rows);
    },

    async consumeUnbound(input) {
      const rows = await database.$client`
        UPDATE "GenerationAccessGrant"
        SET
          "status" = 'consumed'::"GenerationAccessGrantStatus",
          "boundWorkspaceId" = ${input.workspaceId},
          "boundSessionId" = ${input.sessionId},
          "consumedAt" = ${input.now},
          "updatedAt" = ${input.now}
        WHERE "id" = ${input.grantId}
          AND "status" = 'active'::"GenerationAccessGrantStatus"
          AND "boundWorkspaceId" IS NULL
          AND "boundSessionId" IS NULL
          AND "envCodeHash" = ${input.envCodeHash}
        RETURNING "id"
      `;
      const row = Array.isArray(rows) ? rows[0] as { id?: unknown } | undefined : undefined;
      return typeof row?.id === 'string';
    },
  };
}
