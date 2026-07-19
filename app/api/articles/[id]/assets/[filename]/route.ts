import { get } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';

import {
  extractArticleAssetFilename,
  inferBlobAccess,
} from '@/lib/article-assets';
import { getDeckWithAssets } from '@/lib/db';
import { getBlobToken } from '@/lib/image-gen';
import { authorizeArticleRequest } from '@/server/auth/article-authorization';
import { errorResponse } from '@/server/http/errors';
import { logEvent } from '@/server/http/log';

function buildContentDisposition(filename: string, download: boolean) {
  const safeFilename = filename
    .replaceAll('"', '')
    .replaceAll('\\', '')
    .replaceAll('\r', '')
    .replaceAll('\n', '')
    .replace(/[\x00-\x1f\x7f]/g, '');
  return `${download ? 'attachment' : 'inline'}; filename="${safeFilename}"`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> }
) {
  try {
    const { id: deckId, filename } = await params;
    const { workspaceId } = await authorizeArticleRequest(request, deckId);

    if (!filename) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const deck = await getDeckWithAssets(deckId, workspaceId);

    if (!deck) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const slide = deck.slides.find((candidate) => {
      if (!candidate.imageUrl) {
        return false;
      }

      try {
        return extractArticleAssetFilename(candidate.imageUrl) === filename;
      } catch {
        return false;
      }
    });

    if (!slide?.imageUrl) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const blob = await get(slide.imageUrl, {
      access: inferBlobAccess(slide.imageUrl),
      token: getBlobToken(),
    });

    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const download = new URL(request.url).searchParams.get('download') === '1';

    logEvent('info', 'asset.served', { deckId, filename });

    return new NextResponse(blob.stream, {
      headers: {
        'Content-Type': blob.blob.contentType || 'application/octet-stream',
        'Content-Disposition': buildContentDisposition(filename, download),
        'Cache-Control': 'private, no-store, max-age=0',
        Vary: 'Cookie',
      },
    });
  } catch (error) {
    return errorResponse(error, {
      code: 'ASSET_FETCH_FAILED',
      message: 'Failed to fetch asset.',
      status: 500,
    });
  }
}
