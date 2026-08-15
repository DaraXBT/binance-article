import { describe, expect, it, mock } from 'bun:test';

import {
  openManagedBinanceArticlePage,
  releaseBinanceArticleBrowserResource,
} from '../../.agents/skills/baoyu-post-to-binance-square/scripts/binance-article';
import {
  openManagedXArticlePage,
  releaseXArticleBrowserResource,
} from '../../.agents/skills/baoyu-post-to-x/scripts/x-article';

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

function fakeAcquisitionCdp(rejectCommand?: string) {
  const commands: Array<{ method: string; params: unknown }> = [];
  return {
    commands,
    send: mock(async (method: string, params: unknown = {}) => {
      commands.push({ method, params });
      if (method === rejectCommand) throw new Error(`failed during ${method}`);
      if (method === 'Target.getTargets') return { targetInfos: [] };
      if (method === 'Target.createTarget') return { targetId: 'target_created' };
      if (method === 'Target.attachToTarget') return { sessionId: 'session_created' };
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

describe.each([
  ['X', openManagedXArticlePage, releaseXArticleBrowserResource],
  ['Binance', openManagedBinanceArticlePage, releaseBinanceArticleBrowserResource],
] as const)('%s Article managed page acquisition', (_platform, openPage, release) => {
  it('closes a newly launched browser when target discovery fails after CDP connects', async () => {
    const cdp = fakeAcquisitionCdp('Target.getTargets');
    const resource = {
      cdp: cdp as never,
      targetId: undefined,
      ownsBrowser: true,
      ownsTarget: false,
    };

    await expect(openPage(resource)).rejects.toThrow(/Target\.getTargets/i);

    expect(cdp.commands).toEqual([
      { method: 'Target.getTargets', params: {} },
      { method: 'Browser.close', params: {} },
    ]);
    expect(cdp.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    'Target.attachToTarget',
    'Target.activateTarget',
    'Page.enable',
    'Runtime.enable',
    'DOM.enable',
  ])('closes only the fresh target in a reused browser when %s fails', async (failurePoint) => {
    const cdp = fakeAcquisitionCdp(failurePoint);
    const resource = {
      cdp: cdp as never,
      targetId: undefined,
      ownsBrowser: false,
      ownsTarget: false,
    };

    await expect(openPage(resource)).rejects.toThrow(new RegExp(failurePoint, 'i'));

    expect(cdp.commands).toContainEqual({
      method: 'Target.closeTarget', params: { targetId: 'target_created' },
    });
    expect(cdp.commands.some(({ method }) => method === 'Browser.close')).toBe(false);
    expect(cdp.close).toHaveBeenCalledTimes(1);
  });

  it('does not close a reused browser when creating its dedicated target fails', async () => {
    const cdp = fakeAcquisitionCdp('Target.createTarget');
    const resource = {
      cdp: cdp as never,
      targetId: undefined,
      ownsBrowser: false,
      ownsTarget: false,
    };

    await expect(openPage(resource)).rejects.toThrow(/Target\.createTarget/i);

    expect(cdp.commands.some(({ method }) => (
      method === 'Browser.close' || method === 'Target.closeTarget'
    ))).toBe(false);
    expect(cdp.close).toHaveBeenCalledTimes(1);
  });

  it('keeps a successfully acquired reused-browser target alive for handoff', async () => {
    const cdp = fakeAcquisitionCdp();
    const resource = {
      cdp: cdp as never,
      targetId: undefined,
      ownsBrowser: false,
      ownsTarget: false,
    };

    const page = await openPage(resource);

    expect(page).toEqual({ targetId: 'target_created', sessionId: 'session_created' });
    expect(resource).toMatchObject({ targetId: 'target_created', ownsTarget: true });
    expect(cdp.commands.some(({ method }) => (
      method === 'Browser.close' || method === 'Target.closeTarget'
    ))).toBe(false);
    expect(cdp.close).not.toHaveBeenCalled();

    await release(resource as never);
    expect(cdp.commands.at(-1)).toEqual({
      method: 'Target.closeTarget', params: { targetId: 'target_created' },
    });
    expect(cdp.close).toHaveBeenCalledTimes(1);
  });
});
