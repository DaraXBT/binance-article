import { describe, expect, it } from 'vitest';

import { transitionPublisherCommand } from './publisher-command';

const now = new Date('2026-07-19T00:00:00.000Z');
const publishing = {
  state: 'publishing' as const,
  target: 'x' as const,
  kind: 'article' as const,
  revision: 3,
  assignedDeviceId: 'device_a',
  expiresAt: new Date('2026-07-19T00:15:00.000Z'),
};

function success(publishedUrl: string) {
  return {
    type: 'publish_succeeded' as const,
    deviceId: 'device_a',
    revision: 3,
    publishedUrl,
  };
}

describe('kind-aware publisher command success evidence', () => {
  it('accepts an exact canonical X Article URL for an article command', () => {
    expect(transitionPublisherCommand(
      publishing,
      success('https://x.com/example_user/article/123456789'),
      now,
    )).toMatchObject({
      state: 'succeeded',
      target: 'x',
      kind: 'article',
      publishedUrl: 'https://x.com/example_user/article/123456789',
    });
  });

  it.each([
    'https://x.com/example_user/status/123456789',
    'https://x.com/example_user/article/123456789?ref=home',
    'https://x.com/example_user/article/123456789#fragment',
    'https://www.x.com/example_user/article/123456789',
    'https://twitter.com/example_user/article/123456789',
  ])('rejects noncanonical or wrong-kind X Article evidence: %s', (publishedUrl) => {
    expect(() => transitionPublisherCommand(publishing, success(publishedUrl), now))
      .toThrow(/canonical X/i);
  });

  it('rejects an article URL for an X post command', () => {
    expect(() => transitionPublisherCommand(
      { ...publishing, kind: 'post' as const },
      success('https://x.com/example_user/article/123456789'),
      now,
    )).toThrow(/canonical X/i);
  });
});
