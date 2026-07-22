import { describe, expect, it } from 'vitest';

import { transitionPublisherCommand } from './publisher-command';

const base = {
  state: 'queued' as const,
  revision: 3,
  assignedDeviceId: null,
  expiresAt: new Date('2026-07-19T00:15:00.000Z'),
};
const now = new Date('2026-07-19T00:00:00.000Z');

describe('publisher command state machine', () => {
  it('supports the reviewed local-device publication sequence', () => {
    const claimed = transitionPublisherCommand(base, {
      type: 'claim',
      deviceId: 'device_a',
      revision: 3,
    }, now);
    const filled = transitionPublisherCommand(claimed, {
      type: 'editor_filled',
      deviceId: 'device_a',
      revision: 3,
    }, now);
    const awaiting = transitionPublisherCommand(filled, {
      type: 'request_approval',
      revision: 3,
    }, now);
    const approved = transitionPublisherCommand(awaiting, {
      type: 'approve',
      revision: 3,
    }, now);
    const publishing = transitionPublisherCommand(approved, {
      type: 'begin_publish',
      deviceId: 'device_a',
      revision: 3,
    }, now);
    const succeeded = transitionPublisherCommand(publishing, {
      type: 'publish_succeeded',
      deviceId: 'device_a',
      revision: 3,
      publishedUrl: 'https://www.binance.com/en/square/post/123',
    }, now);

    expect([claimed.state, filled.state, awaiting.state, approved.state, publishing.state, succeeded.state])
      .toEqual(['claimed', 'awaiting_review', 'awaiting_approval', 'approved', 'publishing', 'succeeded']);
  });

  it.each([
    ['a different device', { type: 'editor_filled' as const, deviceId: 'device_b', revision: 3 }],
    ['a stale revision', { type: 'editor_filled' as const, deviceId: 'device_a', revision: 2 }],
  ])('rejects %s after a command is claimed', (_label, event) => {
    const claimed = transitionPublisherCommand(base, {
      type: 'claim', deviceId: 'device_a', revision: 3,
    }, now);
    expect(() => transitionPublisherCommand(claimed, event, now)).toThrow();
  });

  it('rejects out-of-order publication and ambiguous success URLs', () => {
    expect(() => transitionPublisherCommand(base, {
      type: 'begin_publish', deviceId: 'device_a', revision: 3,
    }, now)).toThrow(/transition/i);

    const publishing = { ...base, state: 'publishing' as const, assignedDeviceId: 'device_a' };
    expect(() => transitionPublisherCommand(publishing, {
      type: 'publish_succeeded',
      deviceId: 'device_a',
      revision: 3,
      publishedUrl: 'https://evil.example/post/123',
    }, now)).toThrow(/Binance/i);
  });

  it('records an ambiguous Binance result as terminal outcome_unknown', () => {
    const publishing = { ...base, state: 'publishing' as const, assignedDeviceId: 'device_a' };
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
      type: 'begin_publish', deviceId: 'device_a', revision: 3,
    }, now)).toThrow(/terminal/i);
  });

  it('accepts only canonical x.com status URLs for X commands', () => {
    const publishing = {
      ...base,
      target: 'x' as const,
      state: 'publishing' as const,
      assignedDeviceId: 'device_a',
    };
    expect(transitionPublisherCommand(publishing, {
      type: 'publish_succeeded',
      deviceId: 'device_a',
      revision: 3,
      publishedUrl: 'https://x.com/xarticle/status/123456',
    }, now)).toMatchObject({ state: 'succeeded' });
    expect(() => transitionPublisherCommand(publishing, {
      type: 'publish_succeeded',
      deviceId: 'device_a',
      revision: 3,
      publishedUrl: 'https://twitter.com/xarticle/status/123456',
    }, now)).toThrow(/canonical X/i);
    expect(() => transitionPublisherCommand(publishing, {
      type: 'publish_succeeded',
      deviceId: 'device_a',
      revision: 3,
      publishedUrl: 'https://X.com/xarticle/status/123456',
    }, now)).toThrow(/canonical X/i);
    expect(() => transitionPublisherCommand(publishing, {
      type: 'publish_succeeded',
      deviceId: 'device_a',
      revision: 3,
      publishedUrl: 'https://x.com:443/xarticle/status/123456',
    }, now)).toThrow(/canonical X/i);
  });

  it('fails closed for expired commands and terminal-state replays', () => {
    expect(() => transitionPublisherCommand(
      { ...base, expiresAt: now },
      { type: 'claim', deviceId: 'device_a', revision: 3 },
      now,
    )).toThrow(/expired/i);
    expect(() => transitionPublisherCommand(
      { ...base, state: 'cancelled' as const },
      { type: 'claim', deviceId: 'device_a', revision: 3 },
      now,
    )).toThrow(/terminal/i);
  });

  it('marks pre-click work expired as terminal but never expires an in-flight click', () => {
    const awaitingApproval = {
      ...base,
      state: 'awaiting_approval' as const,
      assignedDeviceId: 'device_a',
    };
    const expired = transitionPublisherCommand(awaitingApproval, {
      type: 'expire',
      revision: 3,
    }, now);

    expect(expired.state).toBe('expired');
    expect(() => transitionPublisherCommand(expired, {
      type: 'approve', revision: 3,
    }, now)).toThrow(/terminal/i);
    expect(() => transitionPublisherCommand({
      ...awaitingApproval,
      state: 'publishing' as const,
    }, {
      type: 'expire', revision: 3,
    }, now)).toThrow(/publishing|transition/i);
  });
});
