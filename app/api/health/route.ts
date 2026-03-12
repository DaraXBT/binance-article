import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  let databaseStatus: 'ok' | 'error' = 'error';

  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseStatus = 'ok';
  } catch {
    // Database connectivity issue — don't expose details
  }

  const status = databaseStatus === 'ok' ? 200 : 503;

  return NextResponse.json(
    {
      status: databaseStatus === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}
