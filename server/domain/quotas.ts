import { z } from 'zod';

const MAX_SLIDES_PER_ARTICLE = 10;

export const UserQuotaSchema = z.object({
  articlesPerMonth: z.number().int().nonnegative().safe(),
  imagesPerMonth: z.number().int().nonnegative().safe(),
  maxSlidesPerArticle: z.number().int().min(1).max(MAX_SLIDES_PER_ARTICLE),
  publishingEnabled: z.boolean(),
}).strict();

export type UserQuota = z.infer<typeof UserQuotaSchema>;

export const DEFAULT_USER_QUOTA: Readonly<UserQuota> = Object.freeze({
  articlesPerMonth: 3,
  imagesPerMonth: 24,
  maxSlidesPerArticle: 8,
  publishingEnabled: true,
});

const UsageSchema = z.object({
  articles: z.number().int().nonnegative().safe(),
  images: z.number().int().nonnegative().safe(),
}).strict();

const QuotaRequestSchema = z.object({
  articles: z.number().int().nonnegative().safe(),
  images: z.number().int().nonnegative().safe(),
  slides: z.number().int().min(1).max(MAX_SLIDES_PER_ARTICLE),
  requiresPublishing: z.boolean(),
}).strict();

export const QuotaReservationInputSchema = z.object({
  quota: UserQuotaSchema,
  usage: UsageSchema,
  request: QuotaRequestSchema,
}).strict();

export type QuotaReservationInput = z.infer<typeof QuotaReservationInputSchema>;
export type QuotaLimitCode =
  | 'invalid_input'
  | 'publishing_disabled'
  | 'article_limit'
  | 'image_limit'
  | 'slide_limit';

export class QuotaReservationError extends Error {
  readonly code: QuotaLimitCode;

  constructor(code: QuotaLimitCode, message: string) {
    super(message);
    this.name = 'QuotaReservationError';
    this.code = code;
  }
}

export interface ReservedUsage {
  articles: number;
  images: number;
}

export function reserveQuota(input: QuotaReservationInput): ReservedUsage {
  const parsed = QuotaReservationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new QuotaReservationError('invalid_input', 'Quota reservation input is invalid.');
  }

  const { quota, usage, request } = parsed.data;
  if (request.requiresPublishing && !quota.publishingEnabled) {
    throw new QuotaReservationError('publishing_disabled', 'Publishing is disabled for this user.');
  }
  if (request.slides > quota.maxSlidesPerArticle) {
    throw new QuotaReservationError('slide_limit', 'The requested slide count exceeds the user quota.');
  }

  const articles = usage.articles + request.articles;
  if (!Number.isSafeInteger(articles) || articles > quota.articlesPerMonth) {
    throw new QuotaReservationError('article_limit', 'The monthly article quota would be exceeded.');
  }

  const images = usage.images + request.images;
  if (!Number.isSafeInteger(images) || images > quota.imagesPerMonth) {
    throw new QuotaReservationError('image_limit', 'The monthly image quota would be exceeded.');
  }

  return { articles, images };
}

export function getUsagePeriod(date: Date): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError('Usage period requires a valid date.');
  }

  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}`;
}
