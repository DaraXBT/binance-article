import type { AppDatabase } from '@/server/db/client';

import type {
  CompleteEnrollmentClaimResult,
  EnrollmentClaimRecord,
  EnrollmentClaimStatus,
  EnrollmentCodeRecord,
  EnrollmentRepository,
  ReserveEnrollmentClaimResult,
} from './service';

// This deliberately matches the legacy Invitation repository lock.  Capacity
// decisions across both enrollment systems therefore share one serialization
// point during the compatibility window.
export const ENROLLMENT_CAPACITY_LOCK_KEY = 8_194_261;
export const ENROLLMENT_CODE_LOCK_KEY = 8_194_262;

function rows(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(message);
  return value;
}

function dateValue(value: unknown, field: string): Date {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Enrollment ${field} is invalid.`);
  return parsed;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`Enrollment ${field} is invalid.`);
  return value;
}

function claimStatus(value: unknown): EnrollmentClaimStatus {
  if (
    value !== 'pending' && value !== 'reserved' && value !== 'completed' &&
    value !== 'expired' && value !== 'revoked'
  ) {
    throw new Error('Enrollment claim status is invalid.');
  }
  return value;
}

function readClaim(value: unknown): EnrollmentClaimRecord | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object') throw new Error('Enrollment claim query returned invalid data.');
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string') throw new Error('Enrollment claim id is invalid.');
  const source = row.source;
  if (source !== 'shared_code' && source !== 'legacy_invitation' && source !== 'bootstrap') {
    throw new Error('Enrollment claim source is invalid.');
  }
  const codeVersion = row.codeVersion === null ? null : Number(row.codeVersion);
  if (codeVersion !== null && (!Number.isSafeInteger(codeVersion) || codeVersion < 1)) {
    throw new Error('Enrollment claim code version is invalid.');
  }
  return {
    id: row.id,
    codeId: nullableString(row.codeId, 'claim code id'),
    codeVersion,
    source,
    status: claimStatus(row.status),
    email: nullableString(row.email, 'claim email'),
    userId: nullableString(row.userId, 'claim user id'),
    expiresAt: dateValue(row.expiresAt, 'claim expiry'),
    reservationExpiresAt: row.reservationExpiresAt === null
      ? null
      : dateValue(row.reservationExpiresAt, 'reservation expiry'),
  };
}

function readCode(value: unknown): EnrollmentCodeRecord | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object') throw new Error('Enrollment code query returned invalid data.');
  const row = value as Record<string, unknown>;
  const version = Number(row.version);
  if (
    typeof row.id !== 'string' || !Number.isSafeInteger(version) || version < 1 ||
    typeof row.codePrefix !== 'string' || (row.status !== 'active' && row.status !== 'revoked')
  ) {
    throw new Error('Enrollment code query returned invalid data.');
  }
  return { id: row.id, version, codePrefix: row.codePrefix, status: row.status };
}

function readReservation(value: unknown): ReserveEnrollmentClaimResult {
  if (!value || typeof value !== 'object') throw new Error('Enrollment reservation returned invalid data.');
  const row = value as Record<string, unknown>;
  const outcome = row.outcome;
  if (
    outcome === 'capacity_full' || outcome === 'email_mismatch' ||
    outcome === 'user_disabled' || outcome === 'invalid'
  ) {
    return { outcome };
  }
  if ((outcome === 'reserved' || outcome === 'already_reserved') && typeof row.claimId === 'string') {
    return { outcome, claimId: row.claimId };
  }
  if (
    outcome === 'existing_user' && typeof row.claimId === 'string' &&
    typeof row.userId === 'string'
  ) {
    return { outcome, claimId: row.claimId, userId: row.userId };
  }
  throw new Error('Enrollment reservation returned invalid data.');
}

function readCompletion(value: unknown): CompleteEnrollmentClaimResult {
  if (!value || typeof value !== 'object') throw new Error('Enrollment completion returned invalid data.');
  const row = value as Record<string, unknown>;
  const outcome = row.outcome;
  if (outcome === 'capacity_full' || outcome === 'identity_mismatch' || outcome === 'invalid') {
    return { outcome };
  }
  if (
    (outcome === 'completed' || outcome === 'already_completed') &&
    typeof row.claimId === 'string'
  ) {
    return {
      outcome,
      claimId: row.claimId,
      ...(typeof row.workspaceId === 'string' ? { workspaceId: row.workspaceId } : {}),
    };
  }
  throw new Error('Enrollment completion returned invalid data.');
}

export function createEnrollmentRepository(database: AppDatabase): EnrollmentRepository {
  return {
    async findActiveCodeByHash(input) {
      const result = await database.$client`
        SELECT "id", "version", "codePrefix", "status"
        FROM "EnrollmentCode"
        WHERE "codeHash" = ${input.codeHash}
          AND "status" = 'active'::"EnrollmentCodeStatus"
          AND "createdAt" <= ${input.now}
        LIMIT 1
      `;
      return readCode(rows(result, 'Enrollment code query returned invalid data.')[0]);
    },

    async createClaim(input) {
      const result = await database.$client`
        WITH active_code AS MATERIALIZED (
          SELECT "id", "version"
          FROM "EnrollmentCode"
          WHERE "id" = ${input.codeId}
            AND "version" = ${input.codeVersion}
            AND "status" = 'active'::"EnrollmentCodeStatus"
          FOR SHARE
        ), inserted AS (
          INSERT INTO "EnrollmentClaim" (
            "id", "tokenHash", "tokenPrefix", "codeId", "codeVersion", "source",
            "status", "email", "userId", "idempotencyKeyHash", "expiresAt",
            "reservationExpiresAt", "completedAt", "revokedAt", "failureCode",
            "createdAt", "updatedAt"
          )
          SELECT
            ${input.id}, ${input.tokenHash}, ${input.tokenPrefix}, active_code."id",
            active_code."version", 'shared_code'::"EnrollmentClaimSource",
            'pending'::"EnrollmentClaimStatus", NULL, NULL, ${input.idempotencyKeyHash},
            ${input.expiresAt}, NULL, NULL, NULL, NULL, ${input.now}, ${input.now}
          FROM active_code
          WHERE ${input.expiresAt} > ${input.now}
          ON CONFLICT ("tokenHash") DO UPDATE
          SET "updatedAt" = "EnrollmentClaim"."updatedAt"
          WHERE "EnrollmentClaim"."codeId" = EXCLUDED."codeId"
            AND "EnrollmentClaim"."codeVersion" = EXCLUDED."codeVersion"
            AND "EnrollmentClaim"."idempotencyKeyHash" IS NOT DISTINCT FROM EXCLUDED."idempotencyKeyHash"
            AND "EnrollmentClaim"."status" IN ('pending', 'reserved')
            AND "EnrollmentClaim"."expiresAt" > ${input.now}
          RETURNING
            "id", "codeId", "codeVersion", "source", "status", "email", "userId",
            "expiresAt", "reservationExpiresAt"
        )
        SELECT * FROM inserted
      `;
      return readClaim(rows(result, 'Enrollment claim query returned invalid data.')[0]);
    },

    async createLegacyClaim(input) {
      const result = await database.$client`
        WITH candidate AS MATERIALIZED (
          SELECT
            invitation."id", invitation."email", invitation."expiresAt",
            CASE WHEN invitation."id" LIKE 'bootstrap\\_%' ESCAPE '\\'
              THEN 'bootstrap'::"EnrollmentClaimSource"
              ELSE 'legacy_invitation'::"EnrollmentClaimSource"
            END AS "source"
          FROM "Invitation" AS invitation
          WHERE invitation."tokenHash" = ${input.invitationTokenHash}
            AND invitation."status" IN ('pending'::"InvitationStatus", 'accepted'::"InvitationStatus")
            AND invitation."expiresAt" > ${input.now}
            AND invitation."acceptedByUserId" IS NULL
          FOR UPDATE
        ), accepted AS (
          UPDATE "Invitation" AS invitation
          SET
            "status" = 'accepted'::"InvitationStatus",
            "acceptedAt" = COALESCE(invitation."acceptedAt", ${input.now}),
            "updatedAt" = ${input.now}
          FROM candidate
          WHERE invitation."id" = candidate."id"
          RETURNING invitation."id"
        ), inserted AS (
          INSERT INTO "EnrollmentClaim" (
            "id", "tokenHash", "tokenPrefix", "codeId", "codeVersion", "source",
            "sourceReferenceId", "status", "email", "userId", "idempotencyKeyHash",
            "expiresAt", "reservationExpiresAt", "completedAt", "revokedAt",
            "failureCode", "createdAt", "updatedAt"
          )
          SELECT
            ${input.id}, ${input.tokenHash}, ${input.tokenPrefix}, NULL, NULL,
            candidate."source", candidate."id", 'pending'::"EnrollmentClaimStatus",
            lower(btrim(candidate."email")), NULL, NULL,
            LEAST(candidate."expiresAt", ${input.expiresAt}), NULL, NULL, NULL, NULL,
            ${input.now}, ${input.now}
          FROM candidate
          WHERE LEAST(candidate."expiresAt", ${input.expiresAt}) > ${input.now}
          ON CONFLICT ("tokenHash") DO UPDATE
          SET
            "status" = 'pending'::"EnrollmentClaimStatus",
            "tokenPrefix" = EXCLUDED."tokenPrefix",
            "email" = EXCLUDED."email",
            "reservationExpiresAt" = NULL,
            "expiresAt" = EXCLUDED."expiresAt",
            "failureCode" = NULL,
            "updatedAt" = EXCLUDED."updatedAt"
          WHERE "EnrollmentClaim"."sourceReferenceId" = EXCLUDED."sourceReferenceId"
            AND "EnrollmentClaim"."source" = EXCLUDED."source"
            AND (
              "EnrollmentClaim"."status" IN ('pending'::"EnrollmentClaimStatus", 'expired'::"EnrollmentClaimStatus")
              OR (
                "EnrollmentClaim"."status" = 'reserved'::"EnrollmentClaimStatus"
                AND "EnrollmentClaim"."expiresAt" <= ${input.now}
              )
            )
          RETURNING
            "id", "codeId", "codeVersion", "source", "status", "email", "userId",
            "expiresAt", "reservationExpiresAt"
        ), existing AS (
          SELECT
            claim."id", claim."codeId", claim."codeVersion", claim."source",
            claim."status", claim."email", claim."userId", claim."expiresAt",
            claim."reservationExpiresAt"
          FROM "EnrollmentClaim" AS claim
          INNER JOIN candidate ON candidate."id" = claim."sourceReferenceId"
          WHERE claim."tokenHash" = ${input.tokenHash}
            AND claim."status" IN ('pending', 'reserved')
            AND claim."expiresAt" > ${input.now}
          LIMIT 1
        )
        SELECT * FROM inserted
        UNION ALL
        SELECT * FROM existing
        LIMIT 1
      `;
      return readClaim(rows(result, 'Legacy enrollment claim query returned invalid data.')[0]);
    },

    async reserveClaim(input) {
      const [, result] = await database.$client.transaction((transaction) => [
        transaction`SELECT pg_advisory_xact_lock(${ENROLLMENT_CAPACITY_LOCK_KEY})`,
        transaction`
          WITH expired_claims AS (
            UPDATE "EnrollmentClaim"
            SET
              "status" = 'expired'::"EnrollmentClaimStatus",
              "reservationExpiresAt" = NULL,
              "updatedAt" = ${input.now}
            WHERE "status" IN ('pending', 'reserved')
              AND "expiresAt" <= ${input.now}
            RETURNING "id"
          ), candidate AS MATERIALIZED (
            SELECT claim.*
            FROM "EnrollmentClaim" AS claim
            LEFT JOIN "EnrollmentCode" AS code
              ON code."id" = claim."codeId"
             AND code."version" = claim."codeVersion"
            LEFT JOIN "Invitation" AS legacy_invitation
              ON legacy_invitation."id" = claim."sourceReferenceId"
            WHERE claim."tokenHash" = ${input.claimTokenHash}
              AND claim."status" IN ('pending', 'reserved')
              AND claim."expiresAt" > ${input.now}
              AND (
                (
                  claim."source" = 'shared_code'::"EnrollmentClaimSource"
                  AND code."status" = 'active'::"EnrollmentCodeStatus"
                ) OR (
                  claim."source" IN ('legacy_invitation', 'bootstrap')
                  AND legacy_invitation."status" = 'accepted'::"InvitationStatus"
                  AND legacy_invitation."acceptedByUserId" IS NULL
                  AND legacy_invitation."expiresAt" > ${input.now}
                )
              )
            FOR UPDATE OF claim
          ), existing_user AS MATERIALIZED (
            SELECT account_user."id", account_user."status"
            FROM "user" AS account_user
            WHERE lower(account_user."email") = ${input.email}
            LIMIT 1
          ), capacity AS MATERIALIZED (
            SELECT
              (SELECT count(*)
                FROM "user" AS active_user
                WHERE active_user."status" = 'active'::"UserStatus") +
              (SELECT count(*)
                FROM "Invitation" AS live_invitation
                WHERE (
                  live_invitation."status" = 'pending'::"InvitationStatus"
                  OR (
                    live_invitation."status" = 'accepted'::"InvitationStatus"
                    AND live_invitation."acceptedByUserId" IS NULL
                  )
                )
                AND live_invitation."expiresAt" > ${input.now}
                AND NOT EXISTS (
                  SELECT 1
                  FROM "EnrollmentClaim" AS legacy_claim
                  WHERE legacy_claim."sourceReferenceId" = live_invitation."id"
                    AND legacy_claim."source" IN ('legacy_invitation', 'bootstrap')
                    AND legacy_claim."status" = 'reserved'::"EnrollmentClaimStatus"
                    AND legacy_claim."reservationExpiresAt" > ${input.now}
                    AND legacy_claim."expiresAt" > ${input.now}
                )) +
              (SELECT count(*)
                FROM "EnrollmentClaim" AS reserved_claim
                WHERE reserved_claim."status" = 'reserved'::"EnrollmentClaimStatus"
                  AND reserved_claim."reservationExpiresAt" > ${input.now}
                  AND reserved_claim."expiresAt" > ${input.now}) AS used
          ), decision AS MATERIALIZED (
            SELECT CASE
              WHEN NOT EXISTS (SELECT 1 FROM candidate) THEN 'invalid'
              WHEN EXISTS (
                SELECT 1 FROM candidate
                WHERE "email" IS NOT NULL AND lower("email") <> ${input.email}
              ) THEN 'email_mismatch'
              WHEN EXISTS (
                SELECT 1 FROM existing_user WHERE "status" IN ('suspended', 'revoked')
              ) THEN 'user_disabled'
              WHEN EXISTS (
                SELECT 1 FROM existing_user WHERE "status" = 'active'
              ) THEN 'existing_user'
              WHEN EXISTS (
                SELECT 1 FROM candidate
                WHERE "status" = 'reserved'
                  AND lower("email") = ${input.email}
                  AND "reservationExpiresAt" > ${input.now}
              ) THEN 'already_reserved'
              WHEN EXISTS (
                SELECT 1 FROM candidate
                WHERE "source" = 'shared_code'::"EnrollmentClaimSource"
              ) AND (SELECT used FROM capacity) >= ${input.capacity} THEN 'capacity_full'
              ELSE 'reserved'
            END AS outcome
          ), completed_existing AS (
            UPDATE "EnrollmentClaim" AS claim
            SET
              "status" = 'completed'::"EnrollmentClaimStatus",
              "email" = ${input.email},
              "userId" = existing_user."id",
              "reservationExpiresAt" = NULL,
              "completedAt" = ${input.now},
              "failureCode" = 'existing_user',
              "updatedAt" = ${input.now}
            FROM existing_user, decision
            WHERE claim."id" IN (SELECT "id" FROM candidate)
              AND decision.outcome = 'existing_user'
              AND existing_user."status" = 'active'::"UserStatus"
            RETURNING claim."id"
          ), completed_existing_invitation AS (
            UPDATE "Invitation" AS invitation
            SET
              "acceptedByUserId" = existing_user."id",
              "updatedAt" = ${input.now}
            FROM existing_user, candidate, decision
            WHERE invitation."id" = candidate."sourceReferenceId"
              AND candidate."source" IN ('legacy_invitation', 'bootstrap')
              AND decision.outcome = 'existing_user'
            RETURNING invitation."id"
          ), reserved AS (
            UPDATE "EnrollmentClaim" AS claim
            SET
              "status" = 'reserved'::"EnrollmentClaimStatus",
              "email" = COALESCE(claim."email", ${input.email}),
              "reservationExpiresAt" = LEAST(${input.reservationExpiresAt}, claim."expiresAt"),
              "failureCode" = NULL,
              "updatedAt" = ${input.now}
            FROM decision
            WHERE claim."id" IN (SELECT "id" FROM candidate)
              AND decision.outcome = 'reserved'
            RETURNING claim."id"
          )
          SELECT
            decision.outcome,
            (SELECT "id" FROM candidate LIMIT 1) AS "claimId",
            CASE WHEN decision.outcome = 'existing_user'
              THEN (SELECT "id" FROM existing_user LIMIT 1)
              ELSE NULL
            END AS "userId"
          FROM decision
          LEFT JOIN expired_claims ON false
          LEFT JOIN completed_existing ON false
          LEFT JOIN completed_existing_invitation ON false
          LEFT JOIN reserved ON false
          LIMIT 1
        `,
      ], { isolationLevel: 'ReadCommitted' });
      return readReservation(rows(result, 'Enrollment reservation returned invalid data.')[0]);
    },

    async completeClaim(input) {
      const [, result] = await database.$client.transaction((transaction) => [
        transaction`SELECT pg_advisory_xact_lock(${ENROLLMENT_CAPACITY_LOCK_KEY})`,
        transaction`
          WITH raw_claim AS MATERIALIZED (
            SELECT claim.*
            FROM "EnrollmentClaim" AS claim
            WHERE claim."tokenHash" = ${input.claimTokenHash}
            FOR UPDATE
          ), replay AS MATERIALIZED (
            SELECT
              claim."id" AS "claimId",
              member."workspaceId"
            FROM raw_claim AS claim
            LEFT JOIN "WorkspaceMember" AS member ON member."userId" = claim."userId"
            WHERE claim."status" = 'completed'::"EnrollmentClaimStatus"
              AND claim."userId" = ${input.userId}
          ), candidate AS MATERIALIZED (
            SELECT claim.*
            FROM raw_claim AS claim
            LEFT JOIN "EnrollmentCode" AS code
              ON code."id" = claim."codeId"
             AND code."version" = claim."codeVersion"
            LEFT JOIN "Invitation" AS legacy_invitation
              ON legacy_invitation."id" = claim."sourceReferenceId"
            WHERE claim."status" = 'reserved'::"EnrollmentClaimStatus"
              AND claim."expiresAt" > ${input.now}
              AND claim."reservationExpiresAt" > ${input.now}
              AND (
                (
                  claim."source" = 'shared_code'::"EnrollmentClaimSource"
                  AND code."status" = 'active'::"EnrollmentCodeStatus"
                ) OR (
                  claim."source" IN ('legacy_invitation', 'bootstrap')
                  AND legacy_invitation."status" = 'accepted'::"InvitationStatus"
                  AND legacy_invitation."acceptedByUserId" IS NULL
                  AND legacy_invitation."expiresAt" > ${input.now}
                )
              )
          ), actor AS MATERIALIZED (
            SELECT account_user."id", lower(account_user."email") AS "email"
            FROM "user" AS account_user
            WHERE account_user."id" = ${input.userId}
              AND account_user."status" = 'pending'::"UserStatus"
            FOR UPDATE
          ), capacity AS MATERIALIZED (
            SELECT
              (SELECT count(*)
                FROM "user" AS active_user
                WHERE active_user."status" = 'active'::"UserStatus") +
              (SELECT count(*)
                FROM "Invitation" AS live_invitation
                WHERE (
                  live_invitation."status" = 'pending'::"InvitationStatus"
                  OR (
                    live_invitation."status" = 'accepted'::"InvitationStatus"
                    AND live_invitation."acceptedByUserId" IS NULL
                  )
                )
                AND live_invitation."expiresAt" > ${input.now}
                AND NOT EXISTS (
                  SELECT 1
                  FROM "EnrollmentClaim" AS legacy_claim
                  WHERE legacy_claim."sourceReferenceId" = live_invitation."id"
                    AND legacy_claim."source" IN ('legacy_invitation', 'bootstrap')
                    AND legacy_claim."status" = 'reserved'::"EnrollmentClaimStatus"
                    AND legacy_claim."reservationExpiresAt" > ${input.now}
                    AND legacy_claim."expiresAt" > ${input.now}
                )) +
              (SELECT count(*)
                FROM "EnrollmentClaim" AS reserved_claim
                WHERE reserved_claim."status" = 'reserved'::"EnrollmentClaimStatus"
                  AND reserved_claim."reservationExpiresAt" > ${input.now}
                  AND reserved_claim."expiresAt" > ${input.now}) AS used
          ), eligible AS MATERIALIZED (
            SELECT
              candidate."id" AS "claimId", actor."id" AS "userId",
              candidate."source", candidate."sourceReferenceId"
            FROM candidate
            INNER JOIN actor ON actor."email" = lower(candidate."email")
            WHERE (candidate."userId" IS NULL OR candidate."userId" = actor."id")
              AND (SELECT used FROM capacity) <= ${input.capacity}
          ), existing_membership AS MATERIALIZED (
            SELECT member."workspaceId"
            FROM "WorkspaceMember" AS member
            INNER JOIN eligible ON eligible."userId" = member."userId"
          ), created_workspace AS (
            INSERT INTO "Workspace" (
              "id", "accessKeyHash", "accessKeyPrefix", "origin", "legacyClaimExpiresAt",
              "createdAt", "updatedAt"
            )
            SELECT
              ${input.workspaceId}, ${input.workspaceAccessKeyHash},
              ${input.workspaceAccessKeyPrefix}, 'account'::"WorkspaceOrigin", NULL,
              ${input.now}, ${input.now}
            FROM eligible
            WHERE NOT EXISTS (SELECT 1 FROM existing_membership)
            ON CONFLICT DO NOTHING
            RETURNING "id" AS "workspaceId"
          ), workspace_target AS MATERIALIZED (
            SELECT "workspaceId" FROM existing_membership
            UNION ALL
            SELECT "workspaceId" FROM created_workspace
          ), created_membership AS (
            INSERT INTO "WorkspaceMember" (
              "workspaceId", "userId", "role", "legacyClaimedAt", "createdAt", "updatedAt"
            )
            SELECT
              workspace_target."workspaceId", eligible."userId",
              'owner'::"WorkspaceMemberRole", NULL, ${input.now}, ${input.now}
            FROM workspace_target
            INNER JOIN eligible ON true
            WHERE NOT EXISTS (SELECT 1 FROM existing_membership)
            ON CONFLICT DO NOTHING
            RETURNING "workspaceId"
          ), membership_ready AS MATERIALIZED (
            SELECT "workspaceId" FROM existing_membership
            UNION ALL
            SELECT "workspaceId" FROM created_membership
          ), activated_user AS (
            UPDATE "user" AS account_user
            SET
              "status" = 'active'::"UserStatus",
              "role" = CASE
                WHEN eligible."source" = 'bootstrap'::"EnrollmentClaimSource"
                  AND NOT EXISTS (
                    SELECT 1 FROM "user" AS other_user
                    WHERE other_user."id" <> eligible."userId"
                  )
                THEN 'owner'::"UserRole"
                ELSE account_user."role"
              END,
              "updatedAt" = ${input.now}
            FROM eligible, membership_ready
            WHERE account_user."id" = eligible."userId"
              AND account_user."status" = 'pending'::"UserStatus"
            RETURNING account_user."id"
          ), attached_legacy_invitation AS (
            UPDATE "Invitation" AS invitation
            SET
              "acceptedByUserId" = activated_user."id",
              "updatedAt" = ${input.now}
            FROM activated_user, eligible
            WHERE invitation."id" = eligible."sourceReferenceId"
              AND eligible."source" IN ('legacy_invitation', 'bootstrap')
              AND invitation."acceptedByUserId" IS NULL
            RETURNING invitation."id"
          ), completed_claim AS (
            UPDATE "EnrollmentClaim" AS claim
            SET
              "status" = 'completed'::"EnrollmentClaimStatus",
              "userId" = activated_user."id",
              "reservationExpiresAt" = NULL,
              "completedAt" = ${input.now},
              "failureCode" = NULL,
              "updatedAt" = ${input.now}
            FROM activated_user, eligible
            WHERE claim."id" = eligible."claimId"
            RETURNING claim."id"
          ), audit_event AS (
            INSERT INTO "AuditEvent" (
              "id", "actorUserId", "workspaceId", "eventType", "subjectType",
              "subjectId", "metadata", "createdAt"
            )
            SELECT
              ${input.auditEventId}, activated_user."id", membership_ready."workspaceId",
              'enrollment.completed', 'user', activated_user."id",
              jsonb_build_object(
                'claimId', completed_claim."id",
                'source', candidate."source",
                'codeVersion', candidate."codeVersion"
              ),
              ${input.now}
            FROM activated_user
            INNER JOIN completed_claim ON true
            INNER JOIN membership_ready ON true
            INNER JOIN candidate ON candidate."id" = completed_claim."id"
            LEFT JOIN attached_legacy_invitation ON true
            RETURNING "subjectId"
          ), completed_result AS MATERIALIZED (
            SELECT
              'completed'::text AS outcome,
              completed_claim."id" AS "claimId",
              membership_ready."workspaceId"
            FROM completed_claim
            INNER JOIN membership_ready ON true
            INNER JOIN audit_event ON audit_event."subjectId" = ${input.userId}
          ), fallback AS MATERIALIZED (
            SELECT
              CASE
                WHEN EXISTS (SELECT 1 FROM replay) THEN 'already_completed'
                WHEN EXISTS (SELECT 1 FROM candidate)
                  AND EXISTS (SELECT 1 FROM actor)
                  AND NOT EXISTS (
                    SELECT 1 FROM candidate, actor
                    WHERE actor."email" = lower(candidate."email")
                      AND (candidate."userId" IS NULL OR candidate."userId" = actor."id")
                  ) THEN 'identity_mismatch'
                WHEN EXISTS (SELECT 1 FROM candidate)
                  AND EXISTS (SELECT 1 FROM actor)
                  AND (SELECT used FROM capacity) > ${input.capacity}
                  THEN 'capacity_full'
                ELSE 'invalid'
              END AS outcome
            WHERE NOT EXISTS (SELECT 1 FROM completed_result)
          )
          SELECT outcome, "claimId", "workspaceId" FROM completed_result
          UNION ALL
          SELECT
            fallback.outcome,
            CASE WHEN fallback.outcome = 'already_completed'
              THEN (SELECT "claimId" FROM replay LIMIT 1)
              ELSE NULL
            END AS "claimId",
            CASE WHEN fallback.outcome = 'already_completed'
              THEN (SELECT "workspaceId" FROM replay LIMIT 1)
              ELSE NULL
            END AS "workspaceId"
          FROM fallback
          LIMIT 1
        `,
      ], { isolationLevel: 'ReadCommitted' });
      return readCompletion(rows(result, 'Enrollment completion returned invalid data.')[0]);
    },

    async releaseClaim(input) {
      const result = await database.$client`
        UPDATE "EnrollmentClaim" AS claim
        SET
          "status" = 'pending'::"EnrollmentClaimStatus",
          "reservationExpiresAt" = NULL,
          "updatedAt" = ${input.now}
        WHERE claim."tokenHash" = ${input.claimTokenHash}
          AND claim."status" = 'reserved'::"EnrollmentClaimStatus"
          AND lower(claim."email") = ${input.email}
          AND claim."expiresAt" > ${input.now}
          AND (
            (
              claim."source" = 'shared_code'::"EnrollmentClaimSource"
              AND EXISTS (
                SELECT 1
                FROM "EnrollmentCode" AS code
                WHERE code."id" = claim."codeId"
                  AND code."version" = claim."codeVersion"
                  AND code."status" = 'active'::"EnrollmentCodeStatus"
              )
            ) OR (
              claim."source" IN ('legacy_invitation', 'bootstrap')
              AND EXISTS (
                SELECT 1
                FROM "Invitation" AS invitation
                WHERE invitation."id" = claim."sourceReferenceId"
                  AND invitation."status" = 'accepted'::"InvitationStatus"
                  AND invitation."acceptedByUserId" IS NULL
                  AND invitation."expiresAt" > ${input.now}
              )
            )
          )
        RETURNING claim."id"
      `;
      const row = rows(result, 'Enrollment claim release returned invalid data.')[0] as
        | { id?: unknown }
        | undefined;
      return typeof row?.id === 'string';
    },

    async createCode(input) {
      const [, result] = await database.$client.transaction((transaction) => [
        transaction`SELECT pg_advisory_xact_lock(${ENROLLMENT_CODE_LOCK_KEY})`,
        transaction`
          WITH owner AS MATERIALIZED (
            SELECT "id"
            FROM "user"
            WHERE "id" = ${input.actorUserId}
              AND "role" = 'owner'::"UserRole"
              AND "status" = 'active'::"UserStatus"
          ), decision AS MATERIALIZED (
            SELECT CASE WHEN EXISTS (
              SELECT 1 FROM "EnrollmentCode"
              WHERE "status" = 'active'::"EnrollmentCodeStatus"
            ) THEN 'active_exists' ELSE 'created' END AS outcome
          ), next_version AS MATERIALIZED (
            SELECT COALESCE(max("version"), 0) + 1 AS version FROM "EnrollmentCode"
          ), inserted AS (
            INSERT INTO "EnrollmentCode" (
              "id", "version", "codeHash", "codePrefix", "status",
              "createdByUserId", "revokedByUserId", "revokedAt", "revocationReason",
              "createdAt", "updatedAt"
            )
            SELECT
              ${input.codeId}, next_version.version, ${input.codeHash}, ${input.codePrefix},
              'active'::"EnrollmentCodeStatus", owner."id", NULL, NULL, NULL,
              ${input.now}, ${input.now}
            FROM owner, decision, next_version
            WHERE decision.outcome = 'created'
            RETURNING "id", "version"
          ), audit_event AS (
            INSERT INTO "AuditEvent" (
              "id", "actorUserId", "workspaceId", "eventType", "subjectType",
              "subjectId", "metadata", "createdAt"
            )
            SELECT
              ${input.auditEventId}, owner."id", NULL, 'enrollment.code_created',
              'enrollment_code', inserted."id",
              jsonb_build_object('version', inserted."version"), ${input.now}
            FROM owner, inserted
            RETURNING "subjectId"
          )
          SELECT
            decision.outcome,
            CASE WHEN decision.outcome = 'created'
              THEN (SELECT "version" FROM inserted LIMIT 1)
              ELSE NULL
            END AS version
          FROM decision
          LEFT JOIN audit_event ON false
          LIMIT 1
        `,
      ], { isolationLevel: 'ReadCommitted' });
      const row = rows(result, 'Enrollment code creation returned invalid data.')[0] as
        | Record<string, unknown>
        | undefined;
      if (row?.outcome === 'active_exists') return { outcome: 'active_exists' };
      const version = Number(row?.version);
      if (row?.outcome !== 'created' || !Number.isSafeInteger(version) || version < 1) {
        throw new Error('Enrollment code creation returned invalid data.');
      }
      return { outcome: 'created', version };
    },

    async rotateCode(input) {
      const [, , result] = await database.$client.transaction((transaction) => [
        transaction`SELECT pg_advisory_xact_lock(${ENROLLMENT_CODE_LOCK_KEY})`,
        transaction`
          SELECT "id", "version"
          FROM "EnrollmentCode"
          WHERE "status" = 'active'::"EnrollmentCodeStatus"
          FOR UPDATE
        `,
        transaction`
          WITH owner AS MATERIALIZED (
            SELECT "id"
            FROM "user"
            WHERE "id" = ${input.actorUserId}
              AND "role" = 'owner'::"UserRole"
              AND "status" = 'active'::"UserStatus"
          ), active_code AS MATERIALIZED (
            SELECT "id", "version"
          FROM "EnrollmentCode"
          WHERE "status" = 'active'::"EnrollmentCodeStatus"
          ), next_version AS MATERIALIZED (
            SELECT COALESCE(max("version"), 0) + 1 AS version FROM "EnrollmentCode"
          ), revoked_code AS (
            UPDATE "EnrollmentCode" AS code
            SET
              "status" = 'revoked'::"EnrollmentCodeStatus",
              "revokedByUserId" = owner."id",
              "revokedAt" = ${input.now},
              "revocationReason" = ${input.reason},
              "updatedAt" = ${input.now}
            FROM owner
            WHERE code."id" IN (SELECT "id" FROM active_code)
            RETURNING code."id"
          ), revoked_claims AS (
            UPDATE "EnrollmentClaim" AS claim
            SET
              "status" = 'revoked'::"EnrollmentClaimStatus",
              "reservationExpiresAt" = NULL,
              "revokedAt" = ${input.now},
              "failureCode" = 'code_rotated',
              "updatedAt" = ${input.now}
            FROM active_code, owner
            WHERE claim."codeId" = active_code."id"
              AND claim."codeVersion" = active_code."version"
              AND claim."status" IN ('pending', 'reserved')
            RETURNING claim."id"
          ), inserted AS (
            INSERT INTO "EnrollmentCode" (
              "id", "version", "codeHash", "codePrefix", "status",
              "createdByUserId", "revokedByUserId", "revokedAt", "revocationReason",
              "createdAt", "updatedAt"
            )
            SELECT
              ${input.codeId}, next_version.version, ${input.codeHash}, ${input.codePrefix},
              'active'::"EnrollmentCodeStatus", owner."id", NULL, NULL, NULL,
              ${input.now}, ${input.now}
            FROM owner, next_version
            RETURNING "id", "version"
          ), audit_event AS (
            INSERT INTO "AuditEvent" (
              "id", "actorUserId", "workspaceId", "eventType", "subjectType",
              "subjectId", "metadata", "createdAt"
            )
            SELECT
              ${input.auditEventId}, owner."id", NULL, 'enrollment.code_rotated',
              'enrollment_code', inserted."id",
              jsonb_build_object(
                'version', inserted."version",
                'revokedCodeId', (SELECT "id" FROM revoked_code LIMIT 1),
                'revokedClaimCount', (SELECT count(*) FROM revoked_claims),
                'reason', ${input.reason}
              ),
              ${input.now}
            FROM owner, inserted
            RETURNING "subjectId"
          )
          SELECT
            inserted."version",
            (SELECT "id" FROM revoked_code LIMIT 1) AS "revokedCodeId",
            (SELECT count(*) FROM revoked_claims)::integer AS "revokedClaims"
          FROM inserted
          INNER JOIN audit_event ON audit_event."subjectId" = inserted."id"
          LIMIT 1
        `,
      ], { isolationLevel: 'ReadCommitted' });
      const row = rows(result, 'Enrollment code rotation returned invalid data.')[0] as
        | Record<string, unknown>
        | undefined;
      const version = Number(row?.version);
      const revokedClaims = Number(row?.revokedClaims);
      if (
        !Number.isSafeInteger(version) || version < 1 ||
        !Number.isSafeInteger(revokedClaims) || revokedClaims < 0 ||
        (row?.revokedCodeId !== null && typeof row?.revokedCodeId !== 'string')
      ) {
        throw new Error('Enrollment code rotation returned invalid data.');
      }
      return {
        version,
        revokedCodeId: row.revokedCodeId as string | null,
        revokedClaims,
      };
    },

    async revokeCode(input) {
      const [, , result] = await database.$client.transaction((transaction) => [
        transaction`SELECT pg_advisory_xact_lock(${ENROLLMENT_CODE_LOCK_KEY})`,
        transaction`
          SELECT "id", "version"
          FROM "EnrollmentCode"
          WHERE "status" = 'active'::"EnrollmentCodeStatus"
          FOR UPDATE
        `,
        transaction`
          WITH owner AS MATERIALIZED (
            SELECT "id"
            FROM "user"
            WHERE "id" = ${input.actorUserId}
              AND "role" = 'owner'::"UserRole"
              AND "status" = 'active'::"UserStatus"
          ), active_code AS MATERIALIZED (
            SELECT "id", "version"
            FROM "EnrollmentCode"
            WHERE "status" = 'active'::"EnrollmentCodeStatus"
          ), decision AS MATERIALIZED (
            SELECT CASE
              WHEN NOT EXISTS (SELECT 1 FROM owner) THEN 'not_authorized'
              WHEN EXISTS (SELECT 1 FROM active_code) THEN 'revoked'
              ELSE 'no_active_code'
            END AS outcome
          ), revoked_code AS (
            UPDATE "EnrollmentCode" AS code
            SET
              "status" = 'revoked'::"EnrollmentCodeStatus",
              "revokedByUserId" = owner."id",
              "revokedAt" = ${input.now},
              "revocationReason" = ${input.reason},
              "updatedAt" = ${input.now}
            FROM owner
            WHERE code."id" IN (SELECT "id" FROM active_code)
            RETURNING code."id", code."version"
          ), revoked_claims AS (
            UPDATE "EnrollmentClaim" AS claim
            SET
              "status" = 'revoked'::"EnrollmentClaimStatus",
              "reservationExpiresAt" = NULL,
              "revokedAt" = ${input.now},
              "failureCode" = 'code_revoked',
              "updatedAt" = ${input.now}
            FROM revoked_code
            WHERE claim."codeId" = revoked_code."id"
              AND claim."codeVersion" = revoked_code."version"
              AND claim."source" = 'shared_code'::"EnrollmentClaimSource"
              AND claim."status" IN ('pending', 'reserved')
            RETURNING claim."id"
          ), audit_event AS (
            INSERT INTO "AuditEvent" (
              "id", "actorUserId", "workspaceId", "eventType", "subjectType",
              "subjectId", "metadata", "createdAt"
            )
            SELECT
              ${input.auditEventId}, owner."id", NULL, 'enrollment.code_revoked',
              'enrollment_code', revoked_code."id",
              jsonb_build_object(
                'version', revoked_code."version",
                'revokedClaimCount', (SELECT count(*) FROM revoked_claims),
                'reason', ${input.reason}
              ),
              ${input.now}
            FROM owner, revoked_code
            RETURNING "subjectId"
          )
          SELECT
            decision.outcome,
            (SELECT "id" FROM revoked_code LIMIT 1) AS "revokedCodeId",
            (SELECT count(*) FROM revoked_claims)::integer AS "revokedClaims"
          FROM decision
          LEFT JOIN audit_event ON false
          LIMIT 1
        `,
      ], { isolationLevel: 'ReadCommitted' });
      const row = rows(result, 'Enrollment code revocation returned invalid data.')[0] as
        | Record<string, unknown>
        | undefined;
      if (row?.outcome === 'no_active_code') return { outcome: 'no_active_code' };
      const revokedClaims = Number(row?.revokedClaims);
      if (
        row?.outcome !== 'revoked' || typeof row.revokedCodeId !== 'string' ||
        !Number.isSafeInteger(revokedClaims) || revokedClaims < 0
      ) {
        throw new Error('Enrollment code revocation returned invalid data.');
      }
      return {
        outcome: 'revoked',
        revokedCodeId: row.revokedCodeId,
        revokedClaims,
      };
    },
  };
}
