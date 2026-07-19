import { PublisherApiError } from './api-client';

const IDLE_DELAYS = [2_000, 5_000, 10_000, 20_000, 30_000] as const;

function jitter(value: number, random: () => number): number {
  return Math.max(250, Math.round(value * (0.8 + random() * 0.4)));
}

function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, milliseconds);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

export async function runPublisherLoop(input: {
  signal: AbortSignal;
  runOnce: () => Promise<{ outcome: string }>;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}): Promise<void> {
  const random = input.random ?? Math.random;
  let idleIndex = 0;
  while (!input.signal.aborted) {
    try {
      const result = await input.runOnce();
      if (input.signal.aborted) break;
      if (result.outcome === 'idle') {
        const delay = IDLE_DELAYS[Math.min(idleIndex, IDLE_DELAYS.length - 1)];
        idleIndex += 1;
        await (input.sleep ?? ((milliseconds) => abortableSleep(milliseconds, input.signal)))(
          jitter(delay, random),
        );
      } else {
        idleIndex = 0;
        await (input.sleep ?? ((milliseconds) => abortableSleep(milliseconds, input.signal)))(2_000);
      }
    } catch (error) {
      if (error instanceof PublisherApiError && error.code === 'REPAIR_REQUIRED') throw error;
      const delay = error instanceof PublisherApiError && error.code === 'RATE_LIMITED'
        ? (error.retryAfterSeconds ?? 30) * 1_000
        : 5_000;
      await (input.sleep ?? ((milliseconds) => abortableSleep(milliseconds, input.signal)))(
        jitter(delay, random),
      );
    }
  }
}
