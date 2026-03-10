import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { createGrantedAppAccessCookieValue } from '@/lib/app-access';

describe('middleware', () => {
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

  it('redirects to /access when app access is enabled and no cookie is present', async () => {
    const { middleware } = await import('@/middleware');

    const response = await middleware(new NextRequest('http://localhost/'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/access');
  });

  it('allows the request through when the app access cookie is present', async () => {
    const { middleware } = await import('@/middleware');
    const request = new NextRequest('http://localhost/', {
      headers: {
        cookie: `deckforge_app_access=${await createGrantedAppAccessCookieValue()}`,
      },
    });

    const response = await middleware(request);

    expect(response.status).toBe(200);
  });

  it('invalidates previously granted cookies after APP_ACCESS_CODE rotates', async () => {
    const oldCookieValue = await createGrantedAppAccessCookieValue();
    process.env.APP_ACCESS_CODE = 'SERAPH';
    const { middleware } = await import('@/middleware');
    const request = new NextRequest('http://localhost/', {
      headers: {
        cookie: `deckforge_app_access=${oldCookieValue}`,
      },
    });

    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/access');
  });
});
