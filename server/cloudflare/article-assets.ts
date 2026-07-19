import { getCloudflareContext } from '@opennextjs/cloudflare';

import type { PrivateAssetBucket } from '@/server/modules/publisher/assets/service';

declare global {
  interface CloudflareEnv {
    ARTICLE_ASSETS?: PrivateAssetBucket;
  }
}

export function getArticleAssetsBucket(): PrivateAssetBucket {
  const bucket = getCloudflareContext().env.ARTICLE_ASSETS;
  if (!bucket) {
    throw new Error('ARTICLE_ASSETS R2 binding is required.');
  }
  return bucket;
}
