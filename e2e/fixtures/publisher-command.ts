const MOCK_COMMAND_LIFETIME_MS = 60 * 60 * 1_000;

export function futurePublisherCommandExpiry(now = Date.now()): string {
  return new Date(now + MOCK_COMMAND_LIFETIME_MS).toISOString();
}
