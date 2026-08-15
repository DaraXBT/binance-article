import { describe, expect, it } from 'bun:test';

import { classifySkillPublishResult } from '../src/skill-adapter';

function classified(publishedUrl: string, kind: 'post' | 'article') {
  return classifySkillPublishResult({
    verified: true,
    reason: 'canonical navigation',
    publishedUrl,
  }, 'x', kind);
}

describe('kind-aware publication result classification', () => {
  it('accepts a canonical X Article URL only for an X article command', () => {
    const publishedUrl = 'https://x.com/i/article/1234567890';
    expect(classified(publishedUrl, 'article')).toEqual({ outcome: 'succeeded', publishedUrl });
    expect(classified(publishedUrl, 'post')).toEqual({
      outcome: 'outcome_unknown',
      failureReason: 'OUTCOME_UNVERIFIED',
    });
  });

  it('keeps canonical X status URLs exclusive to post commands', () => {
    const publishedUrl = 'https://x.com/example_user/status/1234567890';
    expect(classified(publishedUrl, 'post')).toEqual({ outcome: 'succeeded', publishedUrl });
    expect(classified(publishedUrl, 'article')).toEqual({
      outcome: 'outcome_unknown',
      failureReason: 'OUTCOME_UNVERIFIED',
    });
  });

  it.each([
    'https://x.com/example/article/1',
    'http://x.com/i/article/1',
    'https://www.x.com/i/article/1',
    'https://twitter.com/i/article/1',
    'https://x.com/i/article/not-a-number',
    'https://x.com/i/article/1/analytics',
    'https://x.com/i/article/1?ref=home',
    'https://x.com/i/article/1#fragment',
    'https://x.com:443/i/article/1',
    'https://X.com/i/article/1',
    'https://x.com/ignored/../i/article/1',
  ])('rejects noncanonical X Article evidence: %s', (publishedUrl) => {
    expect(classified(publishedUrl, 'article')).toEqual({
      outcome: 'outcome_unknown',
      failureReason: 'OUTCOME_UNVERIFIED',
    });
  });
});
