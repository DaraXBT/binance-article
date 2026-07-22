import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';

import {
  dispatchArticleWorkflowJob,
  parseArticleWorkflowPayload,
} from './runner';
import { NonRetryableArticleJobError } from '@/workflows/article-jobs';
import type { ArticleWorkflowPayload } from '@/server/domain/article-workflow';

interface ArticleWorkflowEnvironment {
  DATABASE_URL: string;
  GEMINI_API_KEY: string;
  DEEPSEEK_API_KEY?: string;
  GEMINI_TEXT_MODEL?: string;
  GEMINI_IMAGE_MODEL?: string;
  DEEPSEEK_TEXT_MODEL?: string;
  ARTICLE_ASSETS: R2Bucket;
}

export class ArticleJobsWorkflow extends WorkflowEntrypoint<
  ArticleWorkflowEnvironment,
  ArticleWorkflowPayload
> {
  async run(event: WorkflowEvent<ArticleWorkflowPayload>, step: WorkflowStep) {
    let payload: ArticleWorkflowPayload;
    try {
      payload = parseArticleWorkflowPayload(event.payload);
    } catch {
      throw new NonRetryableError('Invalid article Workflow payload.');
    }

    await step.do('execute article job', {
      retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' },
      timeout: '15 minutes',
    }, async () => {
      try {
        await dispatchArticleWorkflowJob(payload, {
          GEMINI_API_KEY: this.env.GEMINI_API_KEY,
          DEEPSEEK_API_KEY: this.env.DEEPSEEK_API_KEY,
          GEMINI_TEXT_MODEL: this.env.GEMINI_TEXT_MODEL,
          GEMINI_IMAGE_MODEL: this.env.GEMINI_IMAGE_MODEL,
          DEEPSEEK_TEXT_MODEL: this.env.DEEPSEEK_TEXT_MODEL,
        }, { assetBucket: this.env.ARTICLE_ASSETS });
      } catch (error) {
        if (error instanceof NonRetryableArticleJobError) {
          throw new NonRetryableError(error.message);
        }
        throw error;
      }
      return { jobId: payload.jobId, kind: payload.kind };
    });
  }
}

export default {} satisfies ExportedHandler<ArticleWorkflowEnvironment>;
