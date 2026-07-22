import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { neon } from '@neondatabase/serverless';
import type { FullConfig } from '@playwright/test';

const AUTH_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when E2E_SEED_AUTH=1.`);
  return value;
}

function signedCookieValue(token: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(token).digest('base64');
  return encodeURIComponent(`${token}.${signature}`);
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  if (process.env.E2E_SEED_AUTH !== '1') return;

  const databaseUrl = required('DATABASE_URL');
  const secret = required('BETTER_AUTH_SECRET');
  const baseUrl = new URL(required('BETTER_AUTH_URL'));
  const storageStatePath = resolve(required('E2E_STORAGE_STATE'));
  const sql = neon(databaseUrl);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AUTH_MAX_AGE_SECONDS * 1_000);
  const userId = 'e2e_user';
  const workspaceId = 'e2e_workspace';
  const sessionId = randomUUID();
  const sessionToken = randomUUID().replaceAll('-', '');

  // Reset only the deterministic principal in the dedicated E2E database.
  await sql`DELETE FROM "Workspace" WHERE "id" = ${workspaceId}`;
  await sql`DELETE FROM "user" WHERE "id" = ${userId}`;
  await sql`
    INSERT INTO "user" (
      "id", "name", "email", "emailVerified", "status", "role", "createdAt", "updatedAt"
    ) VALUES (
      ${userId}, 'E2E User', 'e2e@example.invalid', true,
      'active'::"UserStatus", 'owner'::"UserRole", ${now}, ${now}
    )
  `;
  await sql`
    INSERT INTO "Workspace" (
      "id", "accessKeyHash", "accessKeyPrefix", "origin", "createdAt", "updatedAt"
    ) VALUES (
      ${workspaceId}, ${'0'.repeat(64)}, 'acct_e2e00001',
      'account'::"WorkspaceOrigin", ${now}, ${now}
    )
  `;
  await sql`
    INSERT INTO "WorkspaceMember" (
      "workspaceId", "userId", "role", "createdAt", "updatedAt"
    ) VALUES (
      ${workspaceId}, ${userId}, 'owner'::"WorkspaceMemberRole", ${now}, ${now}
    )
  `;
  await sql`
    INSERT INTO "UserQuota" (
      "userId", "articlesPerMonth", "imagesPerMonth", "maxSlidesPerArticle",
      "publishingEnabled", "updatedByUserId", "createdAt", "updatedAt"
    ) VALUES (${userId}, 100, 100, 10, true, ${userId}, ${now}, ${now})
  `;
  await sql`
    INSERT INTO "session" (
      "id", "userId", "token", "expiresAt", "createdAt", "updatedAt"
    ) VALUES (${sessionId}, ${userId}, ${sessionToken}, ${expiresAt}, ${now}, ${now})
  `;

  const secure = baseUrl.protocol === 'https:';
  await mkdir(dirname(storageStatePath), { recursive: true });
  await writeFile(storageStatePath, JSON.stringify({
    cookies: [{
      name: `${secure ? '__Secure-' : ''}better-auth.session_token`,
      value: signedCookieValue(sessionToken, secret),
      domain: baseUrl.hostname,
      path: '/',
      expires: Math.floor(expiresAt.getTime() / 1_000),
      httpOnly: true,
      secure,
      sameSite: 'Lax',
    }],
    origins: [],
  }), { mode: 0o600 });
}
