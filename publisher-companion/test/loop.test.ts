import { describe, expect, it, mock } from 'bun:test';

import { PublisherApiError } from '../src/api-client';
import { runPublisherLoop } from '../src/loop';

describe('publisher companion polling loop', () => {
  it('backs off bounded idle polling and stops cleanly on a signal', async () => {
    const controller = new AbortController();
    const delays: number[] = [];
    let calls = 0;
    await runPublisherLoop({
      signal: controller.signal,
      random: () => 0.5,
      runOnce: mock(async () => {
        calls += 1;
        if (calls === 5) controller.abort();
        return { outcome: 'idle' };
      }),
      sleep: mock(async (milliseconds: number) => { delays.push(milliseconds); }),
    });
    expect(delays).toEqual([2_000, 5_000, 10_000, 20_000]);
  });

  it('stops immediately on 401 so a revoked token is never retried', async () => {
    const runOnce = mock(async () => {
      throw new PublisherApiError({
        code: 'REPAIR_REQUIRED', message: 'pair again', status: 401,
      });
    });
    const sleep = mock(async () => undefined);
    await expect(runPublisherLoop({
      signal: new AbortController().signal, runOnce, sleep, random: () => 0.5,
    })).rejects.toMatchObject({ code: 'REPAIR_REQUIRED' });
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
