import { getCloudflareContext } from '@opennextjs/cloudflare';

import {
  ArticleWorkflowPayloadSchema,
  type ArticleWorkflowPayload,
} from '@/server/domain/article-workflow';

interface ArticleWorkflowBinding {
  createBatch(batch: Array<{
    id: string;
    params: ArticleWorkflowPayload;
  }>): Promise<Array<{ id: string }>>;
}

declare global {
  interface CloudflareEnv {
    ARTICLE_JOBS?: ArticleWorkflowBinding;
  }
}

export async function startWorkflow(input: ArticleWorkflowPayload) {
  const payload = ArticleWorkflowPayloadSchema.parse(input);
  const workflow = getCloudflareContext().env.ARTICLE_JOBS;
  if (!workflow) throw new Error('ARTICLE_JOBS Workflow binding is required.');

  await workflow.createBatch([{
    id: payload.jobId,
    params: payload,
  }]);
  return { runId: payload.jobId };
}
