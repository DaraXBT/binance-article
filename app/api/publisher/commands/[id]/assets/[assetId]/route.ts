import { NextRequest } from 'next/server';

import { getArticleAssetsBucket } from '@/server/cloudflare/article-assets';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse } from '@/server/http/errors';
import { createPublisherAssetRepository } from '@/server/modules/publisher/assets/repository';
import { loadPublisherAsset } from '@/server/modules/publisher/assets/service';
import { createPublisherDeviceRepository } from '@/server/modules/publisher/devices/repository';
import { authenticatePublisherDevice } from '@/server/modules/publisher/devices/service';

type RouteContext = {
  params: Promise<{ id: string; assetId: string }>;
};

function formatEntityTag(etag: string): string | undefined {
  const value = etag.trim();
  if (/^(?:W\/)?"[\x21\x23-\x7e]*"$/.test(value)) return value;
  if (/^[\x21\x23-\x7e]+$/.test(value) && !value.includes('"')) return `"${value}"`;
  return undefined;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const database = getRuntimeDatabase();
    const device = await authenticatePublisherDevice({
      repository: createPublisherDeviceRepository(database),
      authorization: request.headers.get('authorization'),
    });
    const { id: commandId, assetId } = await context.params;
    const asset = await loadPublisherAsset({
      repository: createPublisherAssetRepository(database),
      bucket: getArticleAssetsBucket(),
      deviceId: device.id,
      commandId,
      assetId,
    });

    const headers = new Headers({
      'Content-Type': asset.mimeType,
      'Content-Length': String(asset.sizeBytes),
      'X-Content-SHA256': asset.sha256,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (asset.etag) {
      const entityTag = formatEntityTag(asset.etag);
      if (entityTag) headers.set('ETag', entityTag);
    }

    return new Response(asset.body as BodyInit, { headers });
  } catch (error) {
    return errorResponse(error, {
      code: 'PUBLISHER_ASSET_READ_FAILED',
      message: 'The publisher asset could not be loaded.',
      status: 500,
    });
  }
}
