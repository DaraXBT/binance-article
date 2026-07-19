import { z } from 'zod';

import { AppError } from '@/server/http/errors';

const IdentifierSchema = z.string().trim().min(1).max(200);
const AssetMetadataSchema = z.object({
  r2Key: z.string().min(1).max(1_024),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export interface PublisherAssetRepository {
  authorizeAsset(input: {
    deviceId: string;
    commandId: string;
    assetId: string;
  }): Promise<z.infer<typeof AssetMetadataSchema> | null>;
}

export interface PrivateAssetObject {
  body: unknown;
  size: number;
  etag?: string;
}

export interface PrivateAssetBucket {
  get(key: string): Promise<PrivateAssetObject | null>;
}

function notFound(): AppError {
  return new AppError({
    code: 'PUBLISHER_ASSET_NOT_FOUND',
    message: 'Publisher asset not found.',
    status: 404,
  });
}

export async function loadPublisherAsset(input: {
  repository: PublisherAssetRepository;
  bucket: PrivateAssetBucket;
  deviceId: string;
  commandId: string;
  assetId: string;
}) {
  const metadataInput = await input.repository.authorizeAsset({
    deviceId: IdentifierSchema.parse(input.deviceId),
    commandId: IdentifierSchema.parse(input.commandId),
    assetId: IdentifierSchema.parse(input.assetId),
  });
  if (!metadataInput) throw notFound();
  const metadata = AssetMetadataSchema.parse(metadataInput);
  const object = await input.bucket.get(metadata.r2Key);
  if (!object) throw notFound();
  if (object.size !== metadata.sizeBytes) {
    throw new AppError({
      code: 'PUBLISHER_ASSET_INTEGRITY_FAILED',
      message: 'Publisher asset integrity verification failed.',
      status: 409,
    });
  }

  return {
    body: object.body,
    sizeBytes: metadata.sizeBytes,
    mimeType: metadata.mimeType,
    sha256: metadata.sha256,
    ...(object.etag ? { etag: object.etag } : {}),
  };
}
