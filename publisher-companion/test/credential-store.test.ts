import { describe, expect, it, mock } from 'bun:test';

import { KeyringCredentialStore } from '../src/credential-store';

describe('publisher companion credential storage', () => {
  it('stores only the opaque device token in the OS keyring backend', async () => {
    const backend = {
      setPassword: mock(async () => undefined),
      getPassword: mock(async () => 'A'.repeat(43)),
      deletePassword: mock(async () => true),
    };
    const store = new KeyringCredentialStore({
      service: 'binance-article-publisher',
      account: 'device_1',
      backend,
    });

    await store.save('A'.repeat(43));
    await expect(store.read()).resolves.toBe('A'.repeat(43));
    expect(backend.setPassword).toHaveBeenCalledWith(
      'binance-article-publisher', 'device_1', 'A'.repeat(43),
    );
  });

  it('fails closed when a keyring is unavailable and never falls back to a file', async () => {
    const store = new KeyringCredentialStore({
      service: 'binance-article-publisher',
      account: 'device_1',
      backend: {
        setPassword: mock(async () => { throw new Error('keyring unavailable'); }),
        getPassword: mock(async () => null),
        deletePassword: mock(async () => false),
      },
    });

    await expect(store.assertAvailable()).rejects.toThrow(/keyring/i);
    expect(JSON.stringify(store)).not.toContain('filePath');
  });
});
