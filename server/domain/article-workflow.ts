import { z } from 'zod';

export const ArticleWorkflowPayloadSchema = z.object({
  jobId: z.string().trim().min(1).max(100),
  kind: z.enum(['generate', 'generate_images']),
}).strict();

export type ArticleWorkflowPayload = z.infer<typeof ArticleWorkflowPayloadSchema>;
