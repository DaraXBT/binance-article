import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import * as schema from './schema';

function isLocalDatabaseHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.endsWith('.localhost');
}

export function assertNeonDatabaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error('DATABASE_URL is required.');

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol.');
  }
  if (!parsed.hostname || !parsed.pathname || parsed.pathname === '/') {
    throw new Error('DATABASE_URL must include a host and database name.');
  }
  if (!isLocalDatabaseHost(parsed.hostname) && parsed.searchParams.get('sslmode') !== 'require') {
    throw new Error('Remote DATABASE_URL must include sslmode=require.');
  }

  return trimmed;
}

export function createDatabase(databaseUrl: string) {
  const sql = neon(assertNeonDatabaseUrl(databaseUrl));
  return drizzle(sql, { schema });
}

export type AppDatabase = ReturnType<typeof createDatabase>;
