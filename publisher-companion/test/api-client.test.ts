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
});
