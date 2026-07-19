import {
  createHash,
  randomBytes as nodeRandomBytes,
  randomUUID as nodeRandomUuid,
} from 'node:crypto';

import { neon } from '@neondatabase/serverless';

function hashValue(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isLocalDatabaseHost(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.endsWith('.localhost');
}

export function assertOperatorDatabaseUrl(value) {
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
export async function issueGenerationAccessGrant(options = {}) {
  const environment = options.environment ?? process.env;
  const createSql = options.createSql ?? neon;
  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  const randomUuid = options.randomUuid ?? nodeRandomUuid;
  const now = options.now ?? (() => new Date());
  const databaseUrl = assertOperatorDatabaseUrl(
    environment.OPERATOR_DATABASE_URL || environment.DATABASE_URL,
  );
  const configuredCode = environment.GENERATE_ACCESS_CODE?.trim();
  if (!configuredCode) {
    throw new Error('GENERATE_ACCESS_CODE is required before issuing generation access grants.');
  }

  const rawCode = `gac_${randomBytes(18).toString('hex')}`;
  const codePrefix = rawCode.slice(0, 12);
  const id = randomUuid();
  const timestamp = now();
  const sql = createSql(databaseUrl);

  let rows;
  try {
    rows = await sql`
      INSERT INTO "GenerationAccessGrant" (
        "id",
        "codeHash",
        "codePrefix",
        "envCodeHash",
        "status",
        "boundWorkspaceId",
        "boundSessionId",
        "consumedAt",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${id},
        ${hashValue(rawCode)},
        ${codePrefix},
        ${hashValue(configuredCode)},
        'active',
        NULL,
        NULL,
        NULL,
        ${timestamp},
        ${timestamp}
      )
      RETURNING "id", "codePrefix"
    `;
  } catch {
    throw new Error('Generation access grant could not be stored.');
  }

  const created = rows?.[0];
  if (created?.id !== id || created?.codePrefix !== codePrefix) {
    throw new Error('Generation access grant could not be stored.');
  }

  return { id, rawCode, codePrefix };
}

export async function runGenerationAccessGrantCli({
  issue = () => issueGenerationAccessGrant(),
  log = console.log,
  error = console.error,
} = {}) {
  try {
    const grant = await issue();
    log('Generation access grant created.');
    log(`Code: ${grant.rawCode}`);
    log(`Prefix: ${grant.codePrefix}`);
    log(`Grant ID: ${grant.id}`);
    return 0;
  } catch {
    error('Generation access grant could not be created.');
    return 1;
  }
}
