import type { PublisherTarget } from './api-client';

const CANONICAL_X_STATUS_URL = /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/[0-9]+$/;
const CANONICAL_X_ARTICLE_URL = /^https:\/\/x\.com\/i\/article\/[0-9]+$/;

type PublicationKind = 'post' | 'article';

type SkillModule = {
  prepareBundle(input: { bundlePath: string }): Promise<
    | { valid: true }
    | { id: string }
  >;
  publishPreparedDraft(
    draftId: string,
    input: { beforeClick: () => Promise<void> },
  ): Promise<{ verified: true; reason: string; publishedUrl?: string }>;
};

export type PublisherAdapter = {
  prepare(bundlePath: string): Promise<{ draftId: string }>;
  publish(
    draftId: string,
    options: { beforeClick: () => Promise<void> },
  ): Promise<{ verified: true; reason?: string; publishedUrl?: string }>;
  discard?(draftId: string): Promise<void>;
};

async function loadSkill(): Promise<SkillModule> {
  const modulePath = '../../.agents/skills/baoyu-post-to-binance-square/scripts/bundle-publisher.ts';
  return await import(modulePath) as SkillModule;
}

export function canonicalXStatusUrl(value: string): string | null {
  if (!CANONICAL_X_STATUS_URL.test(value)) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:'
      && url.hostname === 'x.com'
      && !url.port
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && /^\/[A-Za-z0-9_]{1,15}\/status\/[0-9]+$/.test(url.pathname)
      && url.toString() === value
    ) {
      return value;
    }
  } catch {
    // Invalid or noncanonical URLs are never success evidence.
  }
  return null;
}

export function canonicalXArticleUrl(value: string): string | null {
  if (!CANONICAL_X_ARTICLE_URL.test(value)) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:'
      && url.hostname === 'x.com'
      && !url.port
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && /^\/i\/article\/[0-9]+$/.test(url.pathname)
      && url.toString() === value
    ) {
      return value;
    }
  } catch {
    // Invalid or noncanonical URLs are never success evidence.
  }
  return null;
}

export function canonicalBinancePublicationUrl(
  value: string,
  kind: PublicationKind,
): string | null {
  try {
    const url = new URL(value);
    const segments = url.pathname.split('/').filter(Boolean);
    const squareIndex = segments.indexOf('square');
    if (
      url.protocol === 'https:'
      && (url.hostname === 'binance.com' || url.hostname === 'www.binance.com')
      && !url.port
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && squareIndex >= 0
      && squareIndex === segments.length - 3
      && segments[squareIndex + 1] === kind
      && /^[A-Za-z0-9_-]+$/.test(segments[squareIndex + 2] ?? '')
      && url.toString() === value
    ) {
      return value;
    }
  } catch {
    // Invalid or noncanonical URLs are never success evidence.
  }
  return null;
}

export function classifySkillPublishResult(input: {
  verified: true;
  reason: string;
  publishedUrl?: string;
}, target: PublisherTarget = 'binance-square', kind?: PublicationKind):
  | { outcome: 'succeeded'; publishedUrl: string }
  | { outcome: 'outcome_unknown'; failureReason: 'OUTCOME_UNVERIFIED' } {
  if (input.publishedUrl) {
    try {
      const url = new URL(input.publishedUrl);
      const canonicalBinanceUrl = target === 'binance-square' && (kind
        ? canonicalBinancePublicationUrl(input.publishedUrl, kind) !== null
        : canonicalBinancePublicationUrl(input.publishedUrl, 'post') !== null
          || canonicalBinancePublicationUrl(input.publishedUrl, 'article') !== null);
      const canonicalXUrl = target === 'x' && (
        kind === 'article'
          ? canonicalXArticleUrl(input.publishedUrl) !== null
          : kind === 'post'
            ? canonicalXStatusUrl(input.publishedUrl) !== null
            : canonicalXStatusUrl(input.publishedUrl) !== null
              || canonicalXArticleUrl(input.publishedUrl) !== null
      );
      if (canonicalBinanceUrl || canonicalXUrl) {
        return { outcome: 'succeeded', publishedUrl: url.toString() };
      }
    } catch {
      // A noncanonical URL is always ambiguous.
    }
  }
  return { outcome: 'outcome_unknown', failureReason: 'OUTCOME_UNVERIFIED' };
}

export class BaoyuBinanceSkillAdapter {
  async prepare(bundlePath: string): Promise<{ draftId: string }> {
    const { prepareBundle } = await loadSkill();
    const prepared = await prepareBundle({ bundlePath });
    if ('valid' in prepared) throw new Error('The Binance skill returned a dry-run result.');
    return { draftId: prepared.id };
  }

  async publish(
    draftId: string,
    options: { beforeClick: () => Promise<void> },
  ) {
    const { publishPreparedDraft } = await loadSkill();
    return publishPreparedDraft(draftId, { beforeClick: options.beforeClick });
  }
}
