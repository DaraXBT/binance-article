import { describe, expect, it } from 'vitest';

import { transitionPublisherCommand } from './publisher-command';

const now = new Date('2026-07-19T00:00:00.000Z');
const publishing = {
  state: 'publishing' as const,
  revision: 3,
  assignedDeviceId: 'device_a',
  expiresAt: new Date('2026-07-19T00:15:00.000Z'),
};

describe('publisher command publish-result validation', () => {
  it('accepts a canonical Binance Square success URL', () => {
    const succeeded = transitionPublisherCommand(publishing, {
      type: 'publish_succeeded',
      deviceId: 'device_a',
      revision: 3,
      publishedUrl: 'https://www.binance.com/en/square/post/123',
    }, now);

    expect(succeeded).toMatchObject({
      state: 'succeeded',
      publishedUrl: 'https://www.binance.com/en/square/post/123',
    });
  });

  it.each([
    ['a different device', { type: 'publish_failed' as const, deviceId: 'device_b', revision: 3, failureReason: 'Editor error.' }],
    ['a stale revision', { type: 'publish_failed' as const, deviceId: 'device_a', revision: 2, failureReason: 'Editor error.' }],
  ])('rejects %s while publishing', (_label, event) => {
    expect(() => transitionPublisherCommand(publishing, event, now)).toThrow();
  });

  it('rejects publish results from any non-publishing state and ambiguous success URLs', () => {
    expect(() => transitionPublisherCommand(
      { ...publishing, state: 'approved' as const },
      {
        type: 'publish_succeeded',
        deviceId: 'device_a',
        revision: 3,
        publishedUrl: 'https://www.binance.com/en/square/post/123',
      },
      now,
    )).toThrow(/transition/i);

    expect(() => transitionPublisherCommand(publishing, {
      type: 'publish_succeeded',
      deviceId: 'device_a',
      revision: 3,
      publishedUrl: 'https://evil.example/post/123',
    }, now)).toThrow(/Binance/i);
  });

  it('records an ambiguous Binance result as terminal outcome_unknown', () => {
    const unknown = transitionPublisherCommand(publishing, {
      type: 'publish_outcome_unknown',
      deviceId: 'device_a',
      revision: 3,
      failureReason: 'Editor closed before the success URL could be verified.',
    }, now);

    expect(unknown).toMatchObject({
      state: 'outcome_unknown',
      failureReason: 'Editor closed before the success URL could be verified.',
    });
    expect(() => transitionPublisherCommand(unknown, {
      type: 'publish_failed',
      deviceId: 'device_a',
      revision: 3,
      failureReason: 'Retry attempt.',
    }, now)).toThrow(/terminal/i);
  });

  it('accepts only canonical x.com status URLs for X commands', () => {
    const publishingX = { ...publishing, target: 'x' as const };
    expect(transitionPublisherCommand(publishingX, {
      type: 'publish_succeeded',
      deviceId: 'device_a',
      revision: 3,
      publishedUrl: 'https://x.com/xarticle/status/123456',
    }, now)).toMatchObject({ state: 'succeeded' });
    expect(() => transitionPublisherCommand(publishingX, {
      type: 'publish_succeeded',
      deviceId: 'device_a',
      revision: 3,
      publishedUrl: 'https://twitter.com/xarticle/status/123456',
    }, now)).toThrow(/canonical X/i);
    expect(() => transitionPublisherCommand(publishingX, {
      type: 'publish_succeeded',
      deviceId: 'device_a',
      revision: 3,
      publishedUrl: 'https://X.com/xarticle/status/123456',
    }, now)).toThrow(/canonical X/i);
    expect(() => transitionPublisherCommand(publishingX, {
      type: 'publish_succeeded',
      deviceId: 'device_a',
      revision: 3,
      publishedUrl: 'https://x.com:443/xarticle/status/123456',
    }, now)).toThrow(/canonical X/i);
  });

  it('fails closed for expired commands and terminal-state replays', () => {
    const result = {
      type: 'publish_failed' as const,
      deviceId: 'device_a',
      revision: 3,
      failureReason: 'Editor error.',
    };
    expect(() => transitionPublisherCommand(
      { ...publishing, expiresAt: now },
      result,
      now,
    )).toThrow(/expired/i);
    expect(() => transitionPublisherCommand(
      { ...publishing, state: 'cancelled' as const },
      result,
      now,
    )).toThrow(/terminal/i);
  });
});
