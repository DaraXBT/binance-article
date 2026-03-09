import { NextRequest, NextResponse } from 'next/server';
import { readAsset, getMimeType } from '@/lib/file-utils';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; filename: string } }
) {
  try {
    const { id: deckId, filename } = params;

    // Read file safely
    const buffer = readAsset(deckId, filename);
    const mimeType = getMimeType(filename);

    // Return file with appropriate headers
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
      },
    });
  } catch (error) {
    console.error('[API] Error fetching asset:', error);

    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Asset not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to fetch asset',
      },
      { status: 500 }
    );
  }
}
