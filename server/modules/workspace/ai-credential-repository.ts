import type { AppDatabase } from '@/server/db/client';

export type AiCredentialProvider = 'gemini';
export type AiCredentialSource = 'platform' | 'workspace';

export interface WorkspaceAiCredentialRecord {
  id: string;
  workspaceId: string;
  provider: AiCredentialProvider;
  ciphertext: string;
  nonce: string;
  encryptionKeyId: string;
  enabled: boolean;
  validatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceAiCredentialRepository {
  findByWorkspaceProvider(input: {
    workspaceId: string;
    provider: AiCredentialProvider;
  }): Promise<WorkspaceAiCredentialRecord | null>;
  findOwned(input: {
    actorUserId: string;
    workspaceId: string;
    provider: AiCredentialProvider;
  }): Promise<WorkspaceAiCredentialRecord | null>;
  saveOwned(input: {
    actorUserId: string;
    workspaceId: string;
    provider: AiCredentialProvider;
    credentialId: string;
    ciphertext: string;
    nonce: string;
    encryptionKeyId: string;
    validatedAt: Date;
    auditEventId: string;
    now: Date;
  }): Promise<{
    operation: 'created' | 'rotated';
    record: WorkspaceAiCredentialRecord;
  } | null>;
  recordValidationOwned(input: {
    actorUserId: string;
    workspaceId: string;
    provider: AiCredentialProvider;
    credentialId: string;
    expectedUpdatedAt: Date;
    validatedAt: Date;
    now: Date;
  }): Promise<WorkspaceAiCredentialRecord | null>;
  changeSourceOwned(input: {
    actorUserId: string;
    workspaceId: string;
    provider: AiCredentialProvider;
    credentialId: string;
    expectedUpdatedAt: Date;
    source: AiCredentialSource;
    validatedAt?: Date;
    auditEventId: string;
    now: Date;
  }): Promise<{ changed: boolean; record: WorkspaceAiCredentialRecord } | null>;
  deleteOwned(input: {
    actorUserId: string;
    workspaceId: string;
    provider: AiCredentialProvider;
    auditEventId: string;
    now: Date;
  }): Promise<{ deleted: boolean }>;
}

export const AI_CREDENTIAL_LOCK_SEED = 4_267_913;

type DatabaseRow = Record<string, unknown>;

function readDate(value: unknown, field: string): Date {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`Workspace AI credential ${field} is invalid.`);
  }
  return parsed;
}

function readNullableDate(value: unknown, field: string): Date | null {
  return value === null || value === undefined ? null : readDate(value, field);
}

function readCredential(row: DatabaseRow | undefined): WorkspaceAiCredentialRecord | null {
  if (!row) return null;
  if (
    typeof row.id !== 'string'
    || typeof row.workspaceId !== 'string'
    || row.provider !== 'gemini'
    || typeof row.ciphertext !== 'string'
    || typeof row.nonce !== 'string'
    || typeof row.encryptionKeyId !== 'string'
    || typeof row.enabled !== 'boolean'
  ) {
    throw new TypeError('Workspace AI credential row is invalid.');
  }

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    encryptionKeyId: row.encryptionKeyId,
    enabled: row.enabled,
    validatedAt: readNullableDate(row.validatedAt, 'validatedAt'),
    createdAt: readDate(row.createdAt, 'createdAt'),
    updatedAt: readDate(row.updatedAt, 'updatedAt'),
  };
}

/**
 * Persists encrypted workspace credentials. Every owner mutation repeats the
 * active-user and workspace-owner checks inside the same SQL transaction as
 * the write; route-level authorization is intentionally not trusted here.
 */
export function createWorkspaceAiCredentialRepository(
  database: AppDatabase,
): WorkspaceAiCredentialRepository {
  return {
    async findByWorkspaceProvider(input) {
      const rows = await database.$client`
        SELECT
          credential."id", credential."workspaceId", credential."provider",
          credential."ciphertext", credential."nonce", credential."encryptionKeyId",
          credential."enabled", credential."validatedAt", credential."createdAt",
          credential."updatedAt"
        FROM "WorkspaceAiCredential" AS credential
        WHERE credential."workspaceId" = ${input.workspaceId}
          AND credential."provider" = ${input.provider}::"AiCredentialProvider"
        LIMIT 1
      `;
      return readCredential((rows as DatabaseRow[])[0]);
    },

    async findOwned(input) {
      const rows = await database.$client`
        SELECT
          credential."id", credential."workspaceId", credential."provider",
          credential."ciphertext", credential."nonce", credential."encryptionKeyId",
          credential."enabled", credential."validatedAt", credential."createdAt",
          credential."updatedAt"
        FROM "WorkspaceAiCredential" AS credential
        INNER JOIN "WorkspaceMember" AS member
          ON member."workspaceId" = credential."workspaceId"
         AND member."userId" = ${input.actorUserId}
         AND member."role" = 'owner'::"WorkspaceMemberRole"
        INNER JOIN "user" AS actor
          ON actor."id" = member."userId"
         AND actor."status" = 'active'::"UserStatus"
        WHERE credential."workspaceId" = ${input.workspaceId}
          AND credential."provider" = ${input.provider}::"AiCredentialProvider"
        LIMIT 1
      `;
      return readCredential((rows as DatabaseRow[])[0]);
    },

    async saveOwned(input) {
      const [, rows] = await database.$client.transaction((transaction) => [
        transaction`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`${input.workspaceId}:${input.provider}`}, ${AI_CREDENTIAL_LOCK_SEED})
          )
        `,
        transaction`
          WITH active_owner AS (
            SELECT member."workspaceId"
            FROM "WorkspaceMember" AS member
            INNER JOIN "user" AS actor
              ON actor."id" = member."userId"
             AND actor."status" = 'active'::"UserStatus"
            WHERE member."workspaceId" = ${input.workspaceId}
              AND member."userId" = ${input.actorUserId}
              AND member."role" = 'owner'::"WorkspaceMemberRole"
          ), existing AS MATERIALIZED (
            SELECT credential."id"
            FROM "WorkspaceAiCredential" AS credential
            INNER JOIN active_owner
              ON active_owner."workspaceId" = credential."workspaceId"
            WHERE credential."provider" = ${input.provider}::"AiCredentialProvider"
            FOR UPDATE
          ), upserted AS (
            INSERT INTO "WorkspaceAiCredential" (
              "id", "workspaceId", "provider", "ciphertext", "nonce",
              "encryptionKeyId", "enabled", "createdByUserId", "updatedByUserId",
              "validatedAt", "createdAt", "updatedAt"
            )
            SELECT
              ${input.credentialId}, active_owner."workspaceId",
              ${input.provider}::"AiCredentialProvider", ${input.ciphertext},
              ${input.nonce}, ${input.encryptionKeyId}, false, ${input.actorUserId},
              ${input.actorUserId}, ${input.validatedAt}, ${input.now}, ${input.now}
            FROM active_owner
            ON CONFLICT ("workspaceId", "provider") DO UPDATE SET
              "ciphertext" = EXCLUDED."ciphertext",
              "nonce" = EXCLUDED."nonce",
              "encryptionKeyId" = EXCLUDED."encryptionKeyId",
              "updatedByUserId" = EXCLUDED."updatedByUserId",
              "validatedAt" = EXCLUDED."validatedAt",
              "updatedAt" = EXCLUDED."updatedAt"
            RETURNING *
          ), audit AS (
            INSERT INTO "AuditEvent" (
              "id", "actorUserId", "workspaceId", "eventType", "subjectType",
              "subjectId", "metadata", "createdAt"
            )
            SELECT
              ${input.auditEventId}, ${input.actorUserId}, upserted."workspaceId",
              CASE WHEN EXISTS (SELECT 1 FROM existing)
                THEN 'ai_credential.rotated'
                ELSE 'ai_credential.created'
              END,
              'workspace_ai_credential', upserted."id",
              jsonb_build_object('provider', 'gemini', 'source', 'settings'),
              ${input.now}
            FROM upserted
            RETURNING "id"
          )
          SELECT
            upserted.*,
            CASE WHEN EXISTS (SELECT 1 FROM existing) THEN 'rotated' ELSE 'created' END AS operation
          FROM upserted
          INNER JOIN audit ON audit."id" = ${input.auditEventId}
        `,
      ], { isolationLevel: 'ReadCommitted' });

      const row = (rows as DatabaseRow[])[0];
      const record = readCredential(row);
      return record && (row?.operation === 'created' || row?.operation === 'rotated')
        ? { operation: row.operation, record }
        : null;
    },

    async recordValidationOwned(input) {
      const rows = await database.$client`
        UPDATE "WorkspaceAiCredential" AS credential
        SET "validatedAt" = ${input.validatedAt},
            "updatedByUserId" = ${input.actorUserId},
            "updatedAt" = ${input.now}
        WHERE credential."id" = ${input.credentialId}
          AND credential."workspaceId" = ${input.workspaceId}
          AND credential."provider" = ${input.provider}::"AiCredentialProvider"
          AND credential."updatedAt" = ${input.expectedUpdatedAt}
          AND EXISTS (
            SELECT 1
            FROM "WorkspaceMember" AS member
            INNER JOIN "user" AS actor
              ON actor."id" = member."userId"
             AND actor."status" = 'active'::"UserStatus"
            WHERE member."workspaceId" = credential."workspaceId"
              AND member."userId" = ${input.actorUserId}
              AND member."role" = 'owner'::"WorkspaceMemberRole"
          )
        RETURNING
          credential."id", credential."workspaceId", credential."provider",
          credential."ciphertext", credential."nonce", credential."encryptionKeyId",
          credential."enabled", credential."validatedAt", credential."createdAt",
          credential."updatedAt"
      `;
      return readCredential((rows as DatabaseRow[])[0]);
    },

    async changeSourceOwned(input) {
      const enabled = input.source === 'workspace';
      const [, rows] = await database.$client.transaction((transaction) => [
        transaction`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`${input.workspaceId}:${input.provider}`}, ${AI_CREDENTIAL_LOCK_SEED})
          )
        `,
        transaction`
          WITH active_owner AS (
            SELECT member."workspaceId"
            FROM "WorkspaceMember" AS member
            INNER JOIN "user" AS actor
              ON actor."id" = member."userId"
             AND actor."status" = 'active'::"UserStatus"
            WHERE member."workspaceId" = ${input.workspaceId}
              AND member."userId" = ${input.actorUserId}
              AND member."role" = 'owner'::"WorkspaceMemberRole"
          ), existing AS MATERIALIZED (
            SELECT credential.*
            FROM "WorkspaceAiCredential" AS credential
            INNER JOIN active_owner
              ON active_owner."workspaceId" = credential."workspaceId"
            WHERE credential."id" = ${input.credentialId}
              AND credential."provider" = ${input.provider}::"AiCredentialProvider"
              AND credential."updatedAt" = ${input.expectedUpdatedAt}
            FOR UPDATE
          ), changed AS (
            UPDATE "WorkspaceAiCredential" AS credential
            SET "enabled" = ${enabled},
                "validatedAt" = CASE
                  WHEN ${enabled} THEN COALESCE(${input.validatedAt ?? null}, credential."validatedAt")
                  ELSE credential."validatedAt"
                END,
                "updatedByUserId" = ${input.actorUserId},
                "updatedAt" = ${input.now}
            FROM existing
            WHERE credential."id" = existing."id"
              AND credential."enabled" <> ${enabled}
            RETURNING credential.*
          ), audit AS (
            INSERT INTO "AuditEvent" (
              "id", "actorUserId", "workspaceId", "eventType", "subjectType",
              "subjectId", "metadata", "createdAt"
            )
            SELECT
              ${input.auditEventId}, ${input.actorUserId}, changed."workspaceId",
              'ai_credential.source_changed', 'workspace_ai_credential', changed."id",
              jsonb_build_object(
                'provider', 'gemini', 'source', 'settings',
                'from', CASE WHEN existing."enabled" THEN 'workspace' ELSE 'platform' END,
                'to', CASE WHEN changed."enabled" THEN 'workspace' ELSE 'platform' END
              ),
              ${input.now}
            FROM changed
            INNER JOIN existing ON existing."id" = changed."id"
            RETURNING "id"
          )
          SELECT
            COALESCE(changed."id", existing."id") AS "id",
            COALESCE(changed."workspaceId", existing."workspaceId") AS "workspaceId",
            COALESCE(changed."provider", existing."provider") AS "provider",
            COALESCE(changed."ciphertext", existing."ciphertext") AS "ciphertext",
            COALESCE(changed."nonce", existing."nonce") AS "nonce",
            COALESCE(changed."encryptionKeyId", existing."encryptionKeyId") AS "encryptionKeyId",
            COALESCE(changed."enabled", existing."enabled") AS "enabled",
            COALESCE(changed."validatedAt", existing."validatedAt") AS "validatedAt",
            COALESCE(changed."createdAt", existing."createdAt") AS "createdAt",
            COALESCE(changed."updatedAt", existing."updatedAt") AS "updatedAt",
            changed."id" IS NOT NULL AS "changed"
          FROM existing
          LEFT JOIN changed ON changed."id" = existing."id"
          LEFT JOIN audit ON audit."id" = ${input.auditEventId}
        `,
      ], { isolationLevel: 'ReadCommitted' });

      const row = (rows as DatabaseRow[])[0];
      const record = readCredential(row);
      return record && typeof row?.changed === 'boolean'
        ? { changed: row.changed, record }
        : null;
    },

    async deleteOwned(input) {
      const [, rows] = await database.$client.transaction((transaction) => [
        transaction`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`${input.workspaceId}:${input.provider}`}, ${AI_CREDENTIAL_LOCK_SEED})
          )
        `,
        transaction`
          WITH active_owner AS (
            SELECT member."workspaceId"
            FROM "WorkspaceMember" AS member
            INNER JOIN "user" AS actor
              ON actor."id" = member."userId"
             AND actor."status" = 'active'::"UserStatus"
            WHERE member."workspaceId" = ${input.workspaceId}
              AND member."userId" = ${input.actorUserId}
              AND member."role" = 'owner'::"WorkspaceMemberRole"
          ), deleted AS (
            DELETE FROM "WorkspaceAiCredential" AS credential
            USING active_owner
            WHERE credential."workspaceId" = active_owner."workspaceId"
              AND credential."provider" = ${input.provider}::"AiCredentialProvider"
            RETURNING credential."id", credential."workspaceId"
          ), audit AS (
            INSERT INTO "AuditEvent" (
              "id", "actorUserId", "workspaceId", "eventType", "subjectType",
              "subjectId", "metadata", "createdAt"
            )
            SELECT
              ${input.auditEventId}, ${input.actorUserId}, deleted."workspaceId",
              'ai_credential.deleted', 'workspace_ai_credential', deleted."id",
              jsonb_build_object('provider', 'gemini', 'source', 'settings'),
              ${input.now}
            FROM deleted
            RETURNING "id"
          )
          SELECT deleted."id"
          FROM deleted
          INNER JOIN audit ON audit."id" = ${input.auditEventId}
        `,
      ], { isolationLevel: 'ReadCommitted' });
      return { deleted: typeof (rows as DatabaseRow[])[0]?.id === 'string' };
    },
  };
}

/** Internal generation-path lookup. This returns encrypted material only. */
export async function findWorkspaceAiCredential(
  database: AppDatabase,
  workspaceId: string,
  provider: AiCredentialProvider = 'gemini',
): Promise<WorkspaceAiCredentialRecord | null> {
  return createWorkspaceAiCredentialRepository(database).findByWorkspaceProvider({
    workspaceId,
    provider,
  });
}
