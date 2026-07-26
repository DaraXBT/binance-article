import {
  handleArticleGenerationJob,
  handleArticleImageRetryJob,
} from '@/workflows/article-jobs';
import {
  ArticleWorkflowPayloadSchema,
  type ArticleWorkflowPayload,
} from '@/server/domain/article-workflow';
import type { ArticleAssetBucket } from '@/server/modules/assets/service';

export function parseArticleWorkflowPayload(input: unknown): ArticleWorkflowPayload {
  return ArticleWorkflowPayloadSchema.parse(input);
}

export async function dispatchArticleWorkflowJob(
  payload: ArticleWorkflowPayload,
  environment?: Record<string, string | undefined>,
  runtime: { assetBucket?: ArticleAssetBucket } = {},
) {
  if (payload.kind === 'generate') {
    if (environment || runtime.assetBucket) {
      await handleArticleGenerationJob(payload.jobId, environment, runtime);
    } else {
      await handleArticleGenerationJob(payload.jobId);
    }
    return;
  }
  if (environment || runtime.assetBucket) {
    await handleArticleImageRetryJob(payload.jobId, environment, runtime);
  } else {
    await handleArticleImageRetryJob(payload.jobId);
  }
}
