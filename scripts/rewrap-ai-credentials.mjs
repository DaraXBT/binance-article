import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { neon } from '@neondatabase/serverless';

// This .ts import relies on Node's unflagged type stripping, available from
// Node 22.18 (matching the engines floor in package.json).
import {
  parseAiCredentialKeyring,
  rewrapWorkspaceAiCredential,
} from '../server/security/ai-credential-crypto.ts';

const BATCH_SIZE = 100;

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

export function assertAiCredentialRewrapEnvironment(environment) {
  if (environment.ALLOW_AI_CREDENTIAL_REWRAP !== '1') {
    throw new Error('Refusing rewrap. Set ALLOW_AI_CREDENTIAL_REWRAP=1 for this operation.');
  }
  if (environment.CONFIRM_AI_CREDENTIAL_REWRAP_BACKUP !== '1') {
    throw new Error('CONFIRM_AI_CREDENTIAL_REWRAP_BACKUP=1 is required after verifying a backup.');
  }
  if (environment.CONFIRM_AI_CREDENTIAL_WRITERS_UPDATED !== '1') {
    throw new Error('CONFIRM_AI_CREDENTIAL_WRITERS_UPDATED=1 is required after deploying the active keyring to both Workers.');
  }
  const keyringJson = environment.AI_CREDENTIAL_KEYRING;
  const rawActiveKeyId = environment.AI_CREDENTIAL_ACTIVE_KEY_ID;
  const activeKeyId = rawActiveKeyId?.trim();
  if (!keyringJson || !activeKeyId) {
    throw new Error('AI credential keyring configuration is required.');
  }
  if (
    rawActiveKeyId !== activeKeyId
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(activeKeyId)
  ) {
    throw new Error('AI_CREDENTIAL_ACTIVE_KEY_ID must be a canonical key ID.');
  }
  return {
    databaseUrl: assertOperatorDatabaseUrl(environment.OPERATOR_DATABASE_URL),
    keyringJson,
    activeKeyId,
  };
}

function readCredentialRow(row) {
  if (
    !row ||
    typeof row.id !== 'string' ||
    typeof row.workspaceId !== 'string' ||
    row.provider !== 'gemini' ||
    typeof row.ciphertext !== 'string' ||
    typeof row.nonce !== 'string' ||
    typeof row.encryptionKeyId !== 'string'
  ) {
    throw new Error('AI credential rewrap encountered an invalid row.');
  }
  return row;
}

/**
 * Re-encrypts old-version records with the active key using compare-and-swap
 * updates. Plaintext and encrypted fields are never returned or logged.
 */
export async function rewrapStoredAiCredentials(options = {}) {
  const environment = options.environment ?? process.env;
  const createSql = options.createSql ?? neon;
  const parseKeyring = options.parseKeyring ?? parseAiCredentialKeyring;
  const rewrapCredential = options.rewrapCredential ?? rewrapWorkspaceAiCredential;
  const { databaseUrl, keyringJson, activeKeyId } = assertAiCredentialRewrapEnvironment(environment);
  const keyring = await parseKeyring(keyringJson, activeKeyId);
  const sql = createSql(databaseUrl);
  let cursor = '';
  let rewrapped = 0;
  let skipped = 0;

  while (true) {
    const rows = await sql`
      SELECT "id", "workspaceId", "provider", "ciphertext", "nonce", "encryptionKeyId"
      FROM "WorkspaceAiCredential"
      WHERE "provider" = 'gemini'::"AiCredentialProvider"
        AND "encryptionKeyId" <> ${activeKeyId}
        AND "id" > ${cursor}
      ORDER BY "id" ASC
      LIMIT ${BATCH_SIZE}
    `;
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const value of rows) {
      const row = readCredentialRow(value);
      cursor = row.id;
      const encrypted = await rewrapCredential({
        workspaceId: row.workspaceId,
        provider: 'gemini',
        ciphertext: row.ciphertext,
        nonce: row.nonce,
        encryptionKeyId: row.encryptionKeyId,
        keyring,
      });
      const updated = await sql`
        UPDATE "WorkspaceAiCredential"
        SET "ciphertext" = ${encrypted.ciphertext},
            "nonce" = ${encrypted.nonce},
            "encryptionKeyId" = ${encrypted.encryptionKeyId},
            "updatedAt" = NOW()
        WHERE "id" = ${row.id}
          AND "provider" = 'gemini'::"AiCredentialProvider"
          AND "ciphertext" = ${row.ciphertext}
          AND "nonce" = ${row.nonce}
          AND "encryptionKeyId" = ${row.encryptionKeyId}
        RETURNING "id"
      `;
      if (Array.isArray(updated) && updated.length === 1) rewrapped += 1;
      else skipped += 1;
    }

    if (rows.length < BATCH_SIZE) break;
  }

  const remainingRows = await sql`
    SELECT COUNT(*)::int AS "remaining"
    FROM "WorkspaceAiCredential"
    WHERE "provider" = 'gemini'::"AiCredentialProvider"
      AND "encryptionKeyId" <> ${activeKeyId}
  `;
  const remaining = Number(remainingRows?.[0]?.remaining);
  if (!Number.isSafeInteger(remaining) || remaining < 0) {
    throw new Error('AI credential rewrap could not verify the remaining row count.');
  }
  if (remaining !== 0) {
    throw new Error('AI credential rewrap left rows on an old encryption key.');
  }

  return { rewrapped, skipped };
}

export async function runAiCredentialRewrapCli({
  rewrap = () => rewrapStoredAiCredentials(),
  log = console.log,
  error = console.error,
} = {}) {
  try {
    const result = await rewrap();
    log(`AI credential rewrap complete: ${result.rewrapped} updated, ${result.skipped} skipped.`);
    return 0;
  } catch {
    error('AI credential rewrap failed. No credential material was printed.');
    return 1;
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) process.exitCode = await runAiCredentialRewrapCli();
