import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  const checks: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    node_env: process.env.NODE_ENV,
    database_url_set: !!process.env.DATABASE_URL,
    database_url_protocol: process.env.DATABASE_URL?.split('://')[0] ?? null,
  };

  try {
    const result = await prisma.$queryRaw<{ now: Date }[]>`SELECT NOW() as now`;
    checks.database = 'connected';
    checks.database_time = result[0]?.now;
  } catch (error) {
    checks.database = 'error';
    checks.database_error = error instanceof Error ? error.message : String(error);
  }

  if (checks.database === 'connected') {
    try {
      const tables = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      `;
      checks.tables = tables.map((t) => t.tablename);
    } catch (error) {
      checks.tables_error = error instanceof Error ? error.message : String(error);
    }
  }

  const status = checks.database === 'connected' ? 200 : 503;
  return NextResponse.json(checks, { status });
}
