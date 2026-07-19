import { describe, expect, it, mock } from 'bun:test';

import { pairPublisherDevice } from '../src/pairing';

describe('publisher device pairing', () => {
  it('checks keyring availability before exchanging the one-time pairing code', async () => {
    const order: string[] = [];
    const credentials = {
      assertAvailable: mock(async () => { order.push('keyring'); }),
      save: mock(async (_token: string) => { order.push('save'); }),
    };
    const api = {
      pairDevice: mock(async (_pairingCode: string) => {
        order.push('exchange');
        return { device: { id: 'device_1' }, deviceToken: 'A'.repeat(43) };
      }),
    };

    await expect(pairPublisherDevice({
      pairingCode: 'B'.repeat(43), api, credentials,
    })).resolves.toEqual({ deviceId: 'device_1' });
    expect(order).toEqual(['keyring', 'exchange', 'save']);
  });

  it('does not exchange a code when secure storage is unavailable', async () => {
    const api = { pairDevice: mock(async () => ({ device: { id: 'x' }, deviceToken: 'A'.repeat(43) })) };
    await expect(pairPublisherDevice({
      pairingCode: 'B'.repeat(43),
      api,
      credentials: {
        assertAvailable: mock(async () => { throw new Error('keyring unavailable'); }),
        save: mock(async () => undefined),
      },
    })).rejects.toThrow(/keyring/i);
    expect(api.pairDevice).not.toHaveBeenCalled();
  });
});
