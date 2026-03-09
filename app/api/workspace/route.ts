import { NextResponse } from 'next/server';

import { getWorkspaceBootstrap } from '@/lib/workspace';

export async function GET() {
  try {
    const workspace = await getWorkspaceBootstrap();

    return NextResponse.json(workspace);
  } catch (error) {
    console.error('[API] Error fetching workspace:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch workspace',
      },
      { status: 500 }
    );
  }
}
