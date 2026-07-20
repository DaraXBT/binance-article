import { getCloudflareContext } from '@opennextjs/cloudflare';

import {
  ArticleWorkflowPayloadSchema,
  type ArticleWorkflowPayload,
} from '@/server/domain/article-workflow';

interface ArticleWorkflowBinding {
  get(id: string): Promise<{ id: string }>;
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

  try {
    await workflow.createBatch([{
      id: payload.jobId,
      params: payload,
    }]);
  } catch (createError) {
    // The deterministic job ID makes retries safe, but Cloudflare reports an
    // existing instance by throwing. Reconcile the instance before deciding
    // whether an ambiguous create (duplicate or timed-out response) failed.
    try {
      await workflow.get(payload.jobId);
    } catch {
      throw createError;
    }
  }
  return { runId: payload.jobId };
}
