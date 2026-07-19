import { getCloudflareContext } from '@opennextjs/cloudflare';

import type { ArticleAssetBucket } from '@/server/modules/assets/service';

declare global {
  interface CloudflareEnv {
    ARTICLE_ASSETS?: ArticleAssetBucket;
  }
}

export function getArticleAssetsBucket(): ArticleAssetBucket {
  const bucket = getCloudflareContext().env.ARTICLE_ASSETS;
  if (!bucket) {
    throw new Error('ARTICLE_ASSETS R2 binding is required.');
  }
  return bucket;
}
