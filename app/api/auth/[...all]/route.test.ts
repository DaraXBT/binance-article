import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { handler: vi.fn() },
  getRuntimeAuth: vi.fn(),
  authGet: vi.fn(async () => new Response('GET auth', { status: 200 })),
  authPost: vi.fn(async () => new Response('POST auth', { status: 200 })),
  toNextJsHandler: vi.fn(),
  getRuntimeDatabase: vi.fn(() => ({ database: true })),
  consumeAtomicRateLimit: vi.fn(async () => ({
    allowed: true, remaining: 19, resetAt: new Date(Date.now() + 600_000),
  })),
  parseAuthEnvironment: vi.fn(() => ({ baseUrl: 'https://articles.example.com' })),
}));

mocks.getRuntimeAuth.mockReturnValue(mocks.auth);
mocks.toNextJsHandler.mockReturnValue({ GET: mocks.authGet, POST: mocks.authPost });

vi.mock('@/server/auth/runtime', () => ({ getRuntimeAuth: mocks.getRuntimeAuth }));
vi.mock('@/server/auth/auth-policy', () => ({ parseAuthEnvironment: mocks.parseAuthEnvironment }));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/http/atomic-rate-limit', () => ({
  consumeAtomicRateLimit: mocks.consumeAtomicRateLimit,
}));
vi.mock('better-auth/next-js', () => ({ toNextJsHandler: mocks.toNextJsHandler }));

describe('/api/auth/*', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates GET and POST to the lazy Better Auth handler', async () => {
    const route = await import('./route');
    const getRequest = new Request('https://articles.example.com/api/auth/get-session');
    const postRequest = new Request('https://articles.example.com/api/auth/sign-in/social', {
      method: 'POST',
    });

    await expect(route.GET(getRequest)).resolves.toHaveProperty('status', 200);
    await expect(route.POST(postRequest)).resolves.toHaveProperty('status', 200);
    expect(mocks.getRuntimeAuth).toHaveBeenCalledTimes(1);
    expect(mocks.toNextJsHandler).toHaveBeenCalledWith(mocks.auth);
    expect(mocks.authGet).toHaveBeenCalledWith(getRequest);
    expect(mocks.authPost).toHaveBeenCalledWith(postRequest);
  });

  it('durably throttles Google OAuth callbacks before account creation', async () => {
    mocks.consumeAtomicRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60_000),
    });
    const route = await import('./route');
    const response = await route.GET(new Request(
      'https://articles.example.com/api/auth/callback/google?code=opaque&state=opaque',
      { headers: { 'cf-connecting-ip': '203.0.113.8' } },
    ));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://articles.example.com/auth/error?error=oauth_rate_limited',
    );
    expect(mocks.consumeAtomicRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      database: { database: true }, limit: 20, windowMs: 10 * 60 * 1_000,
    }));
    expect(mocks.authGet).not.toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('/callback/google'),
    }));
  });

  it('delegates an allowed Google OAuth callback after charging its IP bucket', async () => {
    const route = await import('./route');
    const request = new Request(
      'https://articles.example.com/api/auth/callback/google?code=opaque&state=opaque',
      { headers: { 'cf-connecting-ip': '203.0.113.9' } },
    );

    const response = await route.GET(request);

    expect(response.status).toBe(200);
    expect(mocks.consumeAtomicRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      database: { database: true }, limit: 20, windowMs: 10 * 60 * 1_000,
    }));
    expect(mocks.authGet).toHaveBeenCalledWith(request);
  });
});
