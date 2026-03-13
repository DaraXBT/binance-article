import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

describe('middleware', () => {
  const originalAppAccessCode = process.env.APP_ACCESS_CODE;

  beforeEach(() => {
    delete process.env.APP_ACCESS_CODE;
  });

  afterEach(() => {
    if (typeof originalAppAccessCode === 'string') {
      process.env.APP_ACCESS_CODE = originalAppAccessCode;
      return;
    }

    delete process.env.APP_ACCESS_CODE;
  });

  it('passes all requests through when app access is disabled', async () => {
    const { proxy } = await import('@/proxy');

    const response = await proxy(new NextRequest('http://localhost/'));

    expect(response.status).toBe(200);
  });

  it('redirects protected page requests to /access when app access is enabled', async () => {
    process.env.APP_ACCESS_CODE = 'ANGEL';

    const { proxy } = await import('@/proxy');
    const response = await proxy(new NextRequest('http://localhost/dashboard'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/access');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('returns 403 JSON for protected API requests without the access cookie', async () => {
    process.env.APP_ACCESS_CODE = 'ANGEL';

    const { proxy } = await import('@/proxy');
    const response = await proxy(new NextRequest('http://localhost/api/articles'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'App access required.',
      code: 'APP_ACCESS_REQUIRED',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps /access and /api/access reachable without the access cookie', async () => {
    process.env.APP_ACCESS_CODE = 'ANGEL';

    const { proxy } = await import('@/proxy');
    const accessPageResponse = await proxy(new NextRequest('http://localhost/access'));
    const accessApiResponse = await proxy(new NextRequest('http://localhost/api/access'));

    expect(accessPageResponse.status).toBe(200);
    expect(accessApiResponse.status).toBe(200);
  });

  it('passes requests through with a valid access cookie', async () => {
    process.env.APP_ACCESS_CODE = 'ANGEL';

    const { createGrantedAppAccessCookieValue } = await import('@/lib/app-access');
    const { proxy } = await import('@/proxy');
    const cookieValue = await createGrantedAppAccessCookieValue();
    const request = new NextRequest('http://localhost/dashboard', {
      headers: {
        cookie: `deckforge_app_access=${cookieValue}`,
      },
    });

    const response = await proxy(request);

    expect(response.status).toBe(200);
  });
});
