import {
  handleArticleGenerationJob,
  handleArticleImageRetryJob,
  type ArticleJobProviderEnvironment,
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
  environment: ArticleJobProviderEnvironment,
  runtime: { assetBucket?: ArticleAssetBucket } = {},
) {
  if (payload.kind === 'generate') {
    await handleArticleGenerationJob(payload.jobId, environment, runtime);
    return;
  }
  await handleArticleImageRetryJob(payload.jobId, environment, runtime);
}
