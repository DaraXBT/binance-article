import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { createGrantedAppAccessCookieValue } from '@/lib/app-access';

describe('middleware', () => {
  it('redirects to /access when app access is enabled and no cookie is present', async () => {
    process.env.APP_ACCESS_CODE = 'ANGEL';
    const { middleware } = await import('@/middleware');

    const response = await middleware(new NextRequest('http://localhost/'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/access');
  });

  it('allows the request through when the app access cookie is present', async () => {
    process.env.APP_ACCESS_CODE = 'ANGEL';
    const { middleware } = await import('@/middleware');
    const request = new NextRequest('http://localhost/', {
      headers: {
        cookie: `deckforge_app_access=${await createGrantedAppAccessCookieValue()}`,
      },
    });

    const response = await middleware(request);

    expect(response.status).toBe(200);
  });
});
