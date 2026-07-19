import { describe, expect, it } from 'bun:test';

import { classifySkillPublishResult } from '../src/skill-adapter';

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
