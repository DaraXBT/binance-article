import { describe, expect, it, mock } from 'bun:test';

import { PublisherApiClient, PublisherApiError } from '../src/api-client';

describe('publisher companion API client', () => {
  it('requires HTTPS except for an explicit localhost development mode', () => {
    expect(() => new PublisherApiClient({
      baseUrl: 'http://articles.example.com',
      getDeviceToken: async () => 'A'.repeat(43),
    })).toThrow(/HTTPS/i);
    expect(() => new PublisherApiClient({
      baseUrl: 'http://localhost:3000',
      allowInsecureLocalhost: true,
      getDeviceToken: async () => 'A'.repeat(43),
    })).not.toThrow();
  });

  it('uses a keyring token only in the Authorization header and rejects redirects', async () => {
    const fetchImpl = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${'A'.repeat(43)}`);
      expect(JSON.stringify(init)).not.toContain('chrome');
      return new Response(null, { status: 204 });
    });
    const client = new PublisherApiClient({
      baseUrl: 'https://articles.example.com',
      getDeviceToken: async () => 'A'.repeat(43),
      fetchImpl,
    });

    await expect(client.claimCommand()).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('parses metadata-only status and never accepts credential fields', async () => {
    const fetchImpl = mock(async () => Response.json({
      command: {
        id: 'command_1', state: 'approved', revision: 3, recipeHash: 'a'.repeat(64),
        expiresAt: '2026-07-19T00:15:00.000Z',
      },
    }));
    const client = new PublisherApiClient({
      baseUrl: 'https://articles.example.com',
      getDeviceToken: async () => 'A'.repeat(43),
      fetchImpl,
    });

    await expect(client.getCommandStatus('command_1')).resolves.toMatchObject({
      id: 'command_1', state: 'approved', revision: 3,
    });
  });

  it('turns 401 and 429 into stable control-flow errors without response details', async () => {
    const unauthorized = new PublisherApiClient({
      baseUrl: 'https://articles.example.com',
      getDeviceToken: async () => 'A'.repeat(43),
      fetchImpl: async () => Response.json({ error: 'sensitive server detail' }, { status: 401 }),
    });
    await expect(unauthorized.claimCommand()).rejects.toMatchObject({
      code: 'REPAIR_REQUIRED', status: 401,
    });

    const limited = new PublisherApiClient({
      baseUrl: 'https://articles.example.com',
      getDeviceToken: async () => 'A'.repeat(43),
      fetchImpl: async () => new Response(null, { status: 429, headers: { 'Retry-After': '30' } }),
    });
    try {
      await limited.claimCommand();
      throw new Error('Expected rate limiting.');
    } catch (error) {
      expect(error).toBeInstanceOf(PublisherApiError);
      expect(error).toMatchObject({ code: 'RATE_LIMITED', status: 429, retryAfterSeconds: 30 });
      expect(String(error)).not.toContain('sensitive server detail');
    }
  });

  it('downloads an asset with identity encoding so integrity covers the stored bytes', async () => {
    const fetchImpl = mock(async (request: string | URL | Request, init?: RequestInit) => {
      expect(String(request)).toContain('/api/publisher/commands/command_1/assets/asset_1');
      expect(new Headers(init?.headers).get('accept-encoding')).toBe('identity');
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const client = new PublisherApiClient({
      baseUrl: 'https://articles.example.com',
      getDeviceToken: async () => 'A'.repeat(43),
      fetchImpl,
    });

    const response = await client.downloadAsset('command_1', 'asset_1');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('sends only fixed publisher transition payloads to command endpoints', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const client = new PublisherApiClient({
      baseUrl: 'https://articles.example.com',
      getDeviceToken: async () => 'A'.repeat(43),
      fetchImpl: async (request, init) => {
        requests.push({
          url: String(request),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return Response.json({ state: 'cancelled' });
      },
    });

    await client.abortCommand('command_1', 3, 'EDITOR_COMPOSITION_FAILED');
    expect(requests[0]).toEqual({
      url: 'https://articles.example.com/api/publisher/commands/command_1/abort',
      body: { revision: 3, reasonCode: 'EDITOR_COMPOSITION_FAILED' },
    });
  });
});
