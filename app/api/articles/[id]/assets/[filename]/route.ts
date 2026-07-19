import { NextRequest, NextResponse } from 'next/server';

import {
  extractArticleAssetFilename,
  parseArticleAssetReference,
} from '@/lib/article-assets';
import { getDeckWithAssets } from '@/lib/db';
import { authorizeArticleRequest } from '@/server/auth/article-authorization';
import { getArticleAssetsBucket } from '@/server/cloudflare/article-assets';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse } from '@/server/http/errors';
import { logEvent } from '@/server/http/log';
import { createArticleAssetRepository } from '@/server/modules/assets/repository';
import { loadArticleAsset } from '@/server/modules/assets/service';

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

    const reference = parseArticleAssetReference(slide.imageUrl);
    const asset = await loadArticleAsset({
      repository: createArticleAssetRepository(getRuntimeDatabase()),
      bucket: getArticleAssetsBucket(),
      workspaceId,
      articleId: deckId,
      assetId: reference.assetId,
    });

    const download = new URL(request.url).searchParams.get('download') === '1';

    logEvent('info', 'asset.served', { deckId, filename });

    return new NextResponse(asset.body, {
      headers: {
        'Content-Type': asset.mimeType,
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
