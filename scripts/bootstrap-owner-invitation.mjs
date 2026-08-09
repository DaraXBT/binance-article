import {
  createHash,
  randomBytes as nodeRandomBytes,
  randomUUID as nodeRandomUuid,
} from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { neon } from '@neondatabase/serverless';
import { z } from 'zod';

const INVITATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const BOOTSTRAP_LOCK_KEY = 8_194_262;

function isLocalDatabaseHost(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.endsWith('.localhost');
}

function assertOperatorDatabaseUrl(value) {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error('OPERATOR_DATABASE_URL is required.');

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('OPERATOR_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('OPERATOR_DATABASE_URL must use PostgreSQL.');
  }
  if (!parsed.hostname || !parsed.pathname || parsed.pathname === '/') {
    throw new Error('OPERATOR_DATABASE_URL must include a host and database name.');
  }
  if (!isLocalDatabaseHost(parsed.hostname) && parsed.searchParams.get('sslmode') !== 'require') {
    throw new Error('Remote OPERATOR_DATABASE_URL must include sslmode=require.');
  }
  return trimmed;
}

function assertApplicationOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value?.trim());
  } catch {
    throw new Error('BETTER_AUTH_URL must be a valid application origin.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('BETTER_AUTH_URL must contain only the application origin.');
  }
  const isLocal = parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '::1' ||
    parsed.hostname.endsWith('.localhost');
  if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
    throw new Error('BETTER_AUTH_URL must use HTTPS outside localhost development.');
  }
  return parsed.origin;
}

export function assertBootstrapEnvironment(environment) {
  const databaseUrl = assertOperatorDatabaseUrl(environment.OPERATOR_DATABASE_URL);
  const email = z.string().trim().email().max(320).parse(environment.BOOTSTRAP_OWNER_EMAIL)
    .toLowerCase();
  const baseUrl = assertApplicationOrigin(environment.BETTER_AUTH_URL);
  return { databaseUrl, email, baseUrl };
}

/**
 * @param {{
 *   environment?: Record<string, string | undefined>;
 *   createSql?: (databaseUrl: string) => (
 *     strings: TemplateStringsArray,
 *     ...values: unknown[]
 *   ) => Promise<Array<Record<string, unknown>>>;
 *   randomBytes?: (size: number) => import('node:buffer').Buffer;
 *   randomUuid?: () => string;
 *   now?: () => Date;
 * }} [options]
 */
export async function issueOwnerBootstrapInvitation(options = {}) {
  const environment = options.environment ?? process.env;
  const createSql = options.createSql ?? neon;
  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  const randomUuid = options.randomUuid ?? nodeRandomUuid;
  const now = options.now ?? (() => new Date());
  const { databaseUrl, email, baseUrl } = assertBootstrapEnvironment(environment);

  const rawToken = randomBytes(32).toString('base64url');
  const invitationId = `bootstrap_${randomUuid()}`;
  const auditEventId = `bootstrap_audit_${randomUuid()}`;
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const tokenPrefix = rawToken.slice(0, 8);
  const timestamp = now();
  const expiresAt = new Date(timestamp.getTime() + INVITATION_LIFETIME_MS);
  const sql = createSql(databaseUrl);

  let rows;
  try {
    rows = await sql`
      WITH bootstrap_lock AS (
        SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})
      ), decision AS (
        SELECT (
          NOT EXISTS (SELECT 1 FROM "user")
          AND NOT EXISTS (
            SELECT 1
            FROM "user"
            WHERE "role" = 'owner'::"UserRole"
          )
        ) AS "canCreate"
        FROM bootstrap_lock
      ), revoked_stale AS (
        UPDATE "Invitation"
        SET
          "status" = 'revoked'::"InvitationStatus",
          "revokedAt" = ${timestamp},
          "updatedAt" = ${timestamp}
        WHERE "id" LIKE 'bootstrap\\_%' ESCAPE '\\'
          AND "status" IN ('pending'::"InvitationStatus", 'accepted'::"InvitationStatus")
          AND "acceptedByUserId" IS NULL
          AND EXISTS (SELECT 1 FROM decision WHERE "canCreate")
        RETURNING "id"
      ), inserted AS (
        INSERT INTO "Invitation" (
          "id", "email", "tokenHash", "tokenPrefix", "status",
          "createdByUserId", "acceptedByUserId", "expiresAt",
          "acceptedAt", "revokedAt", "createdAt", "updatedAt"
        )
        SELECT
          ${invitationId}, ${email}, ${tokenHash}, ${tokenPrefix},
          'pending'::"InvitationStatus", NULL, NULL, ${expiresAt},
          NULL, NULL, ${timestamp}, ${timestamp}
        FROM decision
        WHERE "canCreate"
          AND (SELECT count(*) FROM revoked_stale) >= 0
        RETURNING "id", "tokenPrefix"
      ), audit_event AS (
        INSERT INTO "AuditEvent" (
          "id", "actorUserId", "workspaceId", "eventType", "subjectType",
          "subjectId", "metadata", "ipHash", "createdAt"
        )
        SELECT
          ${auditEventId}, NULL, NULL, 'bootstrap.owner_invitation_issued',
          'invitation', inserted."id",
          jsonb_build_object(
            'source', 'operator',
            'replacedStaleCount', (SELECT count(*) FROM revoked_stale)
          ),
          NULL, ${timestamp}
        FROM inserted
        RETURNING "subjectId"
      )
      SELECT
        CASE WHEN audit_event."subjectId" IS NULL THEN 'state_not_empty' ELSE 'created' END AS "result",
        inserted."id",
        inserted."tokenPrefix"
      FROM decision
      LEFT JOIN inserted ON true
      LEFT JOIN audit_event ON audit_event."subjectId" = inserted."id"
    `;
  } catch {
    throw new Error('Owner bootstrap invitation could not be created.');
  }

  const created = rows?.[0];
  if (created?.result === 'state_not_empty') {
    throw new Error('Owner bootstrap is already initialized.');
  }
  if (
    created?.result !== 'created' ||
    created?.id !== invitationId ||
    created?.tokenPrefix !== tokenPrefix
  ) {
    throw new Error('Owner bootstrap invitation could not be created.');
  }

  const joinUrl = new URL('/join', baseUrl);
  joinUrl.searchParams.set('token', rawToken);
  return { invitationId, joinUrl: joinUrl.toString(), expiresAt };
}

export async function runOwnerBootstrapCli({
  issue = () => issueOwnerBootstrapInvitation(),
  log = console.log,
  error = console.error,
} = {}) {
  try {
    const invitation = await issue();
    log('First-owner invitation created. This URL is shown once.');
    log(`Join URL: ${invitation.joinUrl}`);
    log(`Expires at: ${invitation.expiresAt.toISOString()}`);
    log(`Invitation ID: ${invitation.invitationId}`);
    return 0;
  } catch {
    error('First-owner invitation could not be created.');
    return 1;
  }
}

const isDirectRun = process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) process.exitCode = await runOwnerBootstrapCli();
