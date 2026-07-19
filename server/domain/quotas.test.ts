import { describe, expect, it } from 'vitest';

import {
  DEFAULT_USER_QUOTA,
  UserQuotaSchema,
  getUsagePeriod,
  reserveQuota,
} from './quotas';

describe('user quotas', () => {
  it('uses the confirmed private-beta defaults', () => {
    expect(UserQuotaSchema.parse(DEFAULT_USER_QUOTA)).toEqual({
      articlesPerMonth: 3,
      imagesPerMonth: 24,
      maxSlidesPerArticle: 8,
      publishingEnabled: true,
    });
  });

  it.each([
    { articlesPerMonth: -1 },
    { imagesPerMonth: 1.5 },
    { maxSlidesPerArticle: 0 },
    { maxSlidesPerArticle: 11 },
  ])('rejects unsafe or impossible quota input: %j', (override) => {
    expect(() => UserQuotaSchema.parse({ ...DEFAULT_USER_QUOTA, ...override })).toThrow();
  });

  it('reserves article and image usage atomically when all limits allow it', () => {
    expect(reserveQuota({
      quota: DEFAULT_USER_QUOTA,
      usage: { articles: 1, images: 7 },
      request: { articles: 1, images: 8, slides: 8, requiresPublishing: false },
    })).toEqual({ articles: 2, images: 15 });
  });

  it.each([
    ['article_limit', { usage: { articles: 3, images: 0 }, request: { articles: 1, images: 0, slides: 1 } }],
    ['image_limit', { usage: { articles: 0, images: 20 }, request: { articles: 0, images: 5, slides: 5 } }],
    ['slide_limit', { usage: { articles: 0, images: 0 }, request: { articles: 1, images: 9, slides: 9 } }],
  ])('fails closed with %s and does not return a partial reservation', (reason, input) => {
    expect(() => reserveQuota({
      quota: DEFAULT_USER_QUOTA,
      ...input,
      request: { ...input.request, requiresPublishing: false },
    })).toThrowError(expect.objectContaining({ code: reason }));
  });

  it('blocks publication when an administrator disabled it for that user', () => {
    expect(() => reserveQuota({
      quota: { ...DEFAULT_USER_QUOTA, publishingEnabled: false },
      usage: { articles: 0, images: 0 },
      request: { articles: 0, images: 0, slides: 1, requiresPublishing: true },
    })).toThrowError(expect.objectContaining({ code: 'publishing_disabled' }));
  });

  it('uses a stable UTC calendar-month key', () => {
    expect(getUsagePeriod(new Date('2026-01-31T23:59:59.999Z'))).toBe('2026-01');
    expect(getUsagePeriod(new Date('2026-02-01T00:00:00.000Z'))).toBe('2026-02');
  });
});
