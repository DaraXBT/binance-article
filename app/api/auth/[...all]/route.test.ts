import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { handler: vi.fn() },
  getRuntimeAuth: vi.fn(),
  authGet: vi.fn(async () => new Response('GET auth', { status: 200 })),
  authPost: vi.fn(async () => new Response('POST auth', { status: 200 })),
  toNextJsHandler: vi.fn(),
}));

mocks.getRuntimeAuth.mockReturnValue(mocks.auth);
mocks.toNextJsHandler.mockReturnValue({ GET: mocks.authGet, POST: mocks.authPost });

vi.mock('@/server/auth/runtime', () => ({ getRuntimeAuth: mocks.getRuntimeAuth }));
vi.mock('better-auth/next-js', () => ({ toNextJsHandler: mocks.toNextJsHandler }));

describe('/api/auth/*', () => {
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
});
