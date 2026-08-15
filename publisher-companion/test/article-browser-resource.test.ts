import { describe, expect, it, mock } from 'bun:test';

import { releaseBinanceArticleBrowserResource } from '../../.agents/skills/baoyu-post-to-binance-square/scripts/binance-article';
import { releaseXArticleBrowserResource } from '../../.agents/skills/baoyu-post-to-x/scripts/x-article';

function fakeCdp(rejectCommand?: string) {
  const commands: Array<{ method: string; params: unknown }> = [];
  return {
    commands,
    send: mock(async (method: string, params: unknown = {}) => {
      commands.push({ method, params });
      if (method === rejectCommand) throw new Error('transport already closed');
      return {};
    }),
    close: mock(() => undefined),
  };
}

describe.each([
  ['X', releaseXArticleBrowserResource],
  ['Binance', releaseBinanceArticleBrowserResource],
] as const)('%s Article browser resource ownership', (_platform, release) => {
  it('closes an owned browser without separately closing its target', async () => {
    const cdp = fakeCdp('Browser.close');
    const resource = {
      cdp: cdp as never,
      targetId: 'target_owned',
      ownsBrowser: true,
      ownsTarget: true,
    };

    await release(resource);
    await release(resource);

    expect(cdp.commands).toEqual([{ method: 'Browser.close', params: {} }]);
    expect(cdp.close).toHaveBeenCalledTimes(1);
  });

  it('closes only an owned target in a reused browser', async () => {
    const cdp = fakeCdp();

    await release({
      cdp: cdp as never,
      targetId: 'target_reused',
      ownsBrowser: false,
      ownsTarget: true,
    });

    expect(cdp.commands).toEqual([{
      method: 'Target.closeTarget', params: { targetId: 'target_reused' },
    }]);
    expect(cdp.close).toHaveBeenCalledTimes(1);
  });

  it('disconnects without closing an unowned browser or target', async () => {
    const cdp = fakeCdp();

    await release({
      cdp: cdp as never,
      targetId: 'target_unowned',
      ownsBrowser: false,
      ownsTarget: false,
    });

    expect(cdp.commands).toEqual([]);
    expect(cdp.close).toHaveBeenCalledTimes(1);
  });
});
