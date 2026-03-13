import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = {
  checkRateLimit: async () => ({
    allowed: true,
    remaining: 4,
    resetAt: Date.now() + 60_000,
  }),
};

vi.mock('@/server/http/rate-limit', () => rateLimitMock);

describe('/api/access', () => {
  const originalAppAccessCode = process.env.APP_ACCESS_CODE;

  beforeEach(() => {
    process.env.APP_ACCESS_CODE = 'ANGEL';
  });

  afterEach(() => {
    if (typeof originalAppAccessCode === 'string') {
      process.env.APP_ACCESS_CODE = originalAppAccessCode;
      return;
    }

    delete process.env.APP_ACCESS_CODE;
  });

  it('accepts the configured app access code and sets the access cookie', async () => {
    const { POST } = await import('@/app/api/access/route');
    const response = await POST(
      new Request('http://localhost/api/access', {
        method: 'POST',
        body: JSON.stringify({ code: 'ANGEL' }),
      }) as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(response.headers.get('set-cookie')).toContain('deckforge_app_access');
  });

  it('rejects an invalid app access code', async () => {
    const { POST } = await import('@/app/api/access/route');
    const response = await POST(
      new Request('http://localhost/api/access', {
        method: 'POST',
        body: JSON.stringify({ code: 'WRONG' }),
      }) as never
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid access code',
      code: 'INVALID_ACCESS_CODE',
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('continues granting access using the current env-configured code after rotation', async () => {
    process.env.APP_ACCESS_CODE = 'SERAPH';
    const { POST } = await import('@/app/api/access/route');
    const response = await POST(
      new Request('http://localhost/api/access', {
        method: 'POST',
        body: JSON.stringify({ code: 'SERAPH' }),
      }) as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(response.headers.get('set-cookie')).toContain('deckforge_app_access');
  });
});
