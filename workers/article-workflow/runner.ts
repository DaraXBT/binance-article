import {
  handleArticleGenerationJob,
  handleArticleImageRetryJob,
} from '@/workflows/article-jobs';
import {
  ArticleWorkflowPayloadSchema,
  type ArticleWorkflowPayload,
} from '@/server/domain/article-workflow';

export function parseArticleWorkflowPayload(input: unknown): ArticleWorkflowPayload {
  return ArticleWorkflowPayloadSchema.parse(input);
}

export async function dispatchArticleWorkflowJob(payload: ArticleWorkflowPayload) {
  if (payload.kind === 'generate') {
    await handleArticleGenerationJob(payload.jobId);
    return;
  }
  await handleArticleImageRetryJob(payload.jobId);
}
