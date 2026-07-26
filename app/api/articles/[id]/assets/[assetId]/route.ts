import { NextRequest, NextResponse } from 'next/server';

import { parseArticleAssetReference } from '@/lib/article-assets';
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

function referenceForAsset(storedImageUrl: string | null, assetId: string) {
  if (!storedImageUrl) return null;
  try {
    const reference = parseArticleAssetReference(storedImageUrl);
    return reference.assetId === assetId ? reference : null;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    const { id: deckId, assetId } = await params;
    const { workspaceId } = await authorizeArticleRequest(request, deckId);

    if (!assetId) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const deck = await getDeckWithAssets(deckId, workspaceId);

    if (!deck) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    // The asset must still be referenced by this article's current slides or
    // cover; the repository re-checks workspace/article ownership below.
    let purpose: 'slide_image' | 'cover_image' = 'slide_image';
    let reference = deck.slides
      .map((slide) => referenceForAsset(slide.imageUrl, assetId))
      .find((match) => match !== null) ?? null;
    if (!reference) {
      reference = referenceForAsset(deck.cover?.imageUrl ?? null, assetId);
      if (reference) purpose = 'cover_image';
    }

    if (!reference) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const asset = await loadArticleAsset({
      repository: createArticleAssetRepository(getRuntimeDatabase()),
      bucket: getArticleAssetsBucket(),
      workspaceId,
      articleId: deckId,
      assetId: reference.assetId,
      purpose,
    });

    const download = new URL(request.url).searchParams.get('download') === '1';

    logEvent('info', 'asset.served', { deckId, assetId });

    return new NextResponse(asset.body, {
      headers: {
        'Content-Type': asset.mimeType,
        'Content-Disposition': buildContentDisposition(reference.filename, download),
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
