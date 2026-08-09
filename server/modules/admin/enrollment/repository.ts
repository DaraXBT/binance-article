import type { AppDatabase } from '@/server/db/client';
import { ENROLLMENT_CAPACITY_LOCK_KEY } from '@/server/modules/enrollment/repository';

import type {
  EnrollmentAdminRepository,
  EnrollmentOverview,
  EnrollmentPerson,
  PersonAction,
} from './service';

const CAPACITY_LIMIT = 10;

function arrayRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error('Enrollment administration query returned invalid data.');
  return value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
}

function dateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function intValue(value: unknown): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function statusValue(value: unknown): EnrollmentPerson['status'] {
  if (value === 'pending' || value === 'active' || value === 'suspended' || value === 'revoked') {
    return value;
  }
  throw new Error('Enrollment user status is invalid.');
}

function roleValue(value: unknown): EnrollmentPerson['role'] {
  if (value === 'owner' || value === 'user') return value;
  throw new Error('Enrollment user role is invalid.');
}

function readOverview(row: Record<string, unknown> | undefined): EnrollmentOverview {
  if (!row) {
    return {
      code: null,
      capacity: {
        activeUsers: 0,
        legacyInvitations: 0,
        reservedClaims: 0,
        limit: CAPACITY_LIMIT,
      },
    };
  }
  const codeVersion = row.codeVersion === null || row.codeVersion === undefined
    ? null
    : Number(row.codeVersion);
  const code = codeVersion !== null && Number.isSafeInteger(codeVersion) && typeof row.codePrefix === 'string'
    ? {
      version: codeVersion,
      codePrefix: row.codePrefix,
      status: row.codeStatus === 'revoked' ? 'revoked' as const : 'active' as const,
      createdAt: dateOrNull(row.codeCreatedAt),
    }
    : null;
  return {
    code,
    capacity: {
      activeUsers: intValue(row.activeUsers),
      legacyInvitations: intValue(row.legacyInvitations),
      reservedClaims: intValue(row.reservedClaims),
      limit: CAPACITY_LIMIT,
    },
  };
}

export function createEnrollmentAdminRepository(database: AppDatabase): EnrollmentAdminRepository {
  return {
    async getOverview({ now }) {
      const result = await database.$client`
        WITH active_code AS (
          SELECT "version", "codePrefix", "status", "createdAt"
          FROM "EnrollmentCode"
          WHERE "status" = 'active'::"EnrollmentCodeStatus"
          ORDER BY "version" DESC
          LIMIT 1
        ), counts AS (
          SELECT
            (SELECT count(*) FROM "user" WHERE "status" = 'active'::"UserStatus") AS "activeUsers",
            (SELECT count(*)
             FROM "Invitation" AS live_invitation
             WHERE (
                 live_invitation."status" = 'pending'::"InvitationStatus"
                 OR (
                   live_invitation."status" = 'accepted'::"InvitationStatus"
                   AND live_invitation."acceptedByUserId" IS NULL
                 )
               )
               AND live_invitation."expiresAt" > ${now}
               AND NOT EXISTS (
                 SELECT 1
                 FROM "EnrollmentClaim" AS legacy_claim
                 WHERE legacy_claim."sourceReferenceId" = live_invitation."id"
                   AND legacy_claim."source" IN ('legacy_invitation', 'bootstrap')
                   AND legacy_claim."status" = 'reserved'::"EnrollmentClaimStatus"
                   AND legacy_claim."reservationExpiresAt" > ${now}
                   AND legacy_claim."expiresAt" > ${now}
               )) AS "legacyInvitations",
            (SELECT count(*) FROM "EnrollmentClaim" AS reserved_claim
             WHERE reserved_claim."status" = 'reserved'::"EnrollmentClaimStatus"
               AND reserved_claim."reservationExpiresAt" > ${now}
               AND reserved_claim."expiresAt" > ${now}) AS "reservedClaims"
        )
        SELECT active_code."version" AS "codeVersion",
          active_code."codePrefix", active_code."status" AS "codeStatus",
          active_code."createdAt" AS "codeCreatedAt",
          counts."activeUsers", counts."legacyInvitations", counts."reservedClaims"
        FROM counts
        LEFT JOIN active_code ON true
      `;
      return readOverview(arrayRows(result)[0]);
    },

    async listPeople({ actorUserId, limit }) {
      const result = await database.$client`
        SELECT
          account_user."id", account_user."name", account_user."email",
          account_user."role", account_user."status",
          latest_claim."source" AS "enrollmentSource",
          account_user."createdAt",
          max(account_session."updatedAt") AS "lastActiveAt"
        FROM "user" AS account_user
        LEFT JOIN LATERAL (
          SELECT claim."source"
          FROM "EnrollmentClaim" AS claim
          WHERE claim."userId" = account_user."id"
          ORDER BY claim."completedAt" DESC NULLS LAST, claim."createdAt" DESC
          LIMIT 1
        ) AS latest_claim ON true
        LEFT JOIN "session" AS account_session
          ON account_session."userId" = account_user."id"
        GROUP BY account_user."id", latest_claim."source"
        ORDER BY account_user."createdAt" ASC, account_user."id" ASC
        LIMIT ${limit}
      `;
      return arrayRows(result).map((row) => ({
        id: String(row.id),
        name: typeof row.name === 'string' ? row.name : String(row.email),
        email: String(row.email),
        role: roleValue(row.role),
        status: statusValue(row.status),
        enrollmentSource: row.enrollmentSource === null || row.enrollmentSource === undefined
          ? null : String(row.enrollmentSource),
        createdAt: dateOrNull(row.createdAt),
        lastActiveAt: dateOrNull(row.lastActiveAt),
        isCurrentUser: String(row.id) === actorUserId,
      }));
    },

    async updatePersonStatus({ actorUserId, userId, action, now, capacity, auditEventId }) {
      const result = await database.$client.transaction((transaction) => [
        transaction`SELECT pg_advisory_xact_lock(${ENROLLMENT_CAPACITY_LOCK_KEY})`,
        transaction`
          WITH actor AS MATERIALIZED (
            SELECT "id", "role", "status"
            FROM "user"
            WHERE "id" = ${actorUserId}
              AND "role" = 'owner'::"UserRole"
              AND "status" = 'active'::"UserStatus"
            FOR UPDATE
          ), target AS MATERIALIZED (
            SELECT "id", "email", "role", "status"
            FROM "user"
            WHERE "id" = ${userId}
            FOR UPDATE
          ), capacity_usage AS MATERIALIZED (
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
                  AND live_invitation."expiresAt" > ${now}
                  AND NOT EXISTS (
                    SELECT 1
                    FROM "EnrollmentClaim" AS legacy_claim
                    WHERE legacy_claim."sourceReferenceId" = live_invitation."id"
                      AND legacy_claim."source" IN ('legacy_invitation', 'bootstrap')
                      AND legacy_claim."status" = 'reserved'::"EnrollmentClaimStatus"
                      AND legacy_claim."reservationExpiresAt" > ${now}
                      AND legacy_claim."expiresAt" > ${now}
                  )) +
              (SELECT count(*)
                FROM "EnrollmentClaim" AS reserved_claim
                WHERE reserved_claim."status" = 'reserved'::"EnrollmentClaimStatus"
                  AND reserved_claim."reservationExpiresAt" > ${now}
                  AND reserved_claim."expiresAt" > ${now}) AS "used"
          ), target_workspace AS MATERIALIZED (
            SELECT 1 AS "hasWorkspace"
            FROM "WorkspaceMember"
            WHERE "userId" = ${userId}
            LIMIT 1
          ), decision AS MATERIALIZED (
            SELECT CASE
              WHEN NOT EXISTS (SELECT 1 FROM actor) OR NOT EXISTS (SELECT 1 FROM target) THEN 'not_found'
              WHEN ${actorUserId} = ${userId} THEN 'self'
              WHEN ${action} = 'restore' AND EXISTS (
                SELECT 1 FROM target
                WHERE "status" NOT IN ('suspended'::"UserStatus", 'revoked'::"UserStatus")
              ) THEN 'invalid_transition'
              WHEN ${action} = 'suspend' AND EXISTS (SELECT 1 FROM target WHERE "status" NOT IN ('active'::"UserStatus", 'pending'::"UserStatus")) THEN 'invalid_transition'
              WHEN ${action} = 'revoke' AND EXISTS (SELECT 1 FROM target WHERE "status" = 'revoked'::"UserStatus") THEN 'invalid_transition'
              WHEN ${action} = 'restore'
                AND (SELECT "used" FROM capacity_usage) >= ${capacity} THEN 'capacity_full'
              WHEN ${action} IN ('suspend', 'revoke') AND EXISTS (
                SELECT 1 FROM target WHERE "role" = 'owner'::"UserRole"
              ) AND NOT EXISTS (
                SELECT 1
                FROM "user" AS other_owner
                WHERE other_owner."role" = 'owner'::"UserRole"
                  AND other_owner."status" = 'active'::"UserStatus"
                  AND other_owner."id" <> ${userId}
              ) THEN 'last_owner'
              ELSE 'updated'
            END AS outcome
          ), updated AS (
            UPDATE "user" AS target_user
            SET
              "status" = CASE
                WHEN ${action} = 'suspend' THEN 'suspended'::"UserStatus"
                WHEN ${action} = 'revoke' THEN 'revoked'::"UserStatus"
                WHEN EXISTS (SELECT 1 FROM target_workspace) THEN 'active'::"UserStatus"
                ELSE 'pending'::"UserStatus"
              END,
              "updatedAt" = ${now}
            FROM decision
            WHERE target_user."id" = ${userId}
              AND decision.outcome = 'updated'
            RETURNING target_user."id", target_user."email", target_user."status"
          ), invalidated_sessions AS (
            DELETE FROM "session" AS account_session
            USING updated
            WHERE account_session."userId" = updated."id"
              AND ${action} IN ('suspend', 'revoke')
            RETURNING account_session."id"
          ), revoked_devices AS (
            UPDATE "PublisherDevice" AS device
            SET "status" = 'revoked'::"PublisherDeviceStatus",
              "revokedAt" = ${now}, "updatedAt" = ${now}
            FROM updated
            WHERE device."userId" = updated."id"
              AND ${action} IN ('suspend', 'revoke')
              AND device."status" <> 'revoked'::"PublisherDeviceStatus"
            RETURNING device."id"
          ), revoked_claims AS (
            UPDATE "EnrollmentClaim" AS claim
            SET "status" = 'revoked'::"EnrollmentClaimStatus",
              "reservationExpiresAt" = NULL, "revokedAt" = ${now},
              "failureCode" = 'user_status_changed', "updatedAt" = ${now}
            FROM updated
            WHERE (
                claim."userId" = updated."id"
                OR lower(claim."email") = lower(updated."email")
              )
              AND claim."status" IN ('pending', 'reserved')
              AND ${action} IN ('suspend', 'revoke')
            RETURNING claim."id"
          ), audit_event AS (
            INSERT INTO "AuditEvent" (
              "id", "actorUserId", "workspaceId", "eventType", "subjectType", "subjectId", "metadata", "createdAt"
            )
            SELECT ${auditEventId}, actor."id", NULL, 'user.status_changed', 'user', updated."id",
              jsonb_build_object('action', ${action}, 'status', updated."status"), ${now}
            FROM actor, updated
            RETURNING "subjectId"
          )
          SELECT decision.outcome, updated."status"
          FROM decision
          LEFT JOIN updated ON true
          LEFT JOIN invalidated_sessions ON false
          LEFT JOIN revoked_devices ON false
          LEFT JOIN revoked_claims ON false
          LEFT JOIN audit_event ON false
          LIMIT 1
        `,
      ], { isolationLevel: 'ReadCommitted' });
      const row = arrayRows(result[1])[0];
      const outcome = row?.outcome;
      if (outcome === 'updated') {
        return { outcome: 'updated' as const, status: statusValue(row.status) };
      }
      if (
        outcome === 'not_found' || outcome === 'self' || outcome === 'owner' ||
        outcome === 'last_owner' || outcome === 'invalid_transition' || outcome === 'capacity_full'
      ) return { outcome };
      throw new Error('Enrollment user status update returned invalid data.');
    },
  };
}
