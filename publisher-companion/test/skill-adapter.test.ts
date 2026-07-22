import { describe, expect, it } from 'bun:test';

import {
  canonicalXStatusUrl,
  classifySkillPublishResult,
} from '../src/skill-adapter';

describe('Binance skill adapter result classification', () => {
  it('accepts success only with a canonical Binance Square URL', () => {
    expect(classifySkillPublishResult({
      verified: true,
      reason: 'canonical navigation',
      publishedUrl: 'https://www.binance.com/en/square/post/123',
    })).toEqual({ outcome: 'succeeded', publishedUrl: 'https://www.binance.com/en/square/post/123' });
  });

  it('treats toast-only or noncanonical results as outcome_unknown', () => {
    expect(classifySkillPublishResult({ verified: true, reason: 'toast' }))
      .toEqual({ outcome: 'outcome_unknown', failureReason: 'OUTCOME_UNVERIFIED' });
    expect(classifySkillPublishResult({
      verified: true, reason: 'bad redirect', publishedUrl: 'https://evil.example/post/1',
    })).toEqual({ outcome: 'outcome_unknown', failureReason: 'OUTCOME_UNVERIFIED' });
  });
});

describe('X skill adapter result classification', () => {
  it('accepts only canonical x.com status URLs', () => {
    const publishedUrl = 'https://x.com/example_user/status/1234567890';
    expect(canonicalXStatusUrl(publishedUrl)).toBe(publishedUrl);
    expect(classifySkillPublishResult({
      verified: true,
      reason: 'canonical navigation',
      publishedUrl,
    }, 'x')).toEqual({ outcome: 'succeeded', publishedUrl });
  });

  it.each([
    'http://x.com/example/status/1',
    'https://www.x.com/example/status/1',
    'https://twitter.com/example/status/1',
    'https://x.com/example/status/not-a-number',
    'https://x.com/example/status/1/analytics',
    'https://x.com/example/status/1?ref=home',
    'https://x.com/example/status/1#fragment',
    'https://x.com:443/example/status/1',
    'https://X.com/example/status/1',
    'https://x.com/ignored/../example/status/1',
    'https://x.com/this_username_is_too_long/status/1',
  ])('treats %s as ambiguous and never reports success', (publishedUrl) => {
    expect(canonicalXStatusUrl(publishedUrl)).toBeNull();
    expect(classifySkillPublishResult({
      verified: true,
      reason: 'ambiguous navigation',
      publishedUrl,
    }, 'x')).toEqual({ outcome: 'outcome_unknown', failureReason: 'OUTCOME_UNVERIFIED' });
  });
});
