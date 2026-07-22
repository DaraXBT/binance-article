import { expect, test } from '@playwright/test';

import { futurePublisherCommandExpiry } from './fixtures/publisher-command';

test('publisher command mocks stay unexpired relative to test start', () => {
  const now = Date.now();
  const expiresAt = futurePublisherCommandExpiry(now);

  expect(Date.parse(expiresAt)).toBe(now + 60 * 60 * 1_000);
  expect(Date.parse(expiresAt)).toBeGreaterThan(now);
});
