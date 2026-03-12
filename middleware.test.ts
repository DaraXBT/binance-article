import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

describe('middleware', () => {
  it('passes all requests through without redirecting', async () => {
    const { proxy } = await import('@/proxy');

    const response = await proxy(new NextRequest('http://localhost/'));

    expect(response.status).toBe(200);
  });

  it('passes requests through regardless of cookies', async () => {
    const { proxy } = await import('@/proxy');
    const request = new NextRequest('http://localhost/dashboard', {
      headers: {
        cookie: 'deckforge_app_access=some-value',
      },
    });

    const response = await proxy(request);

    expect(response.status).toBe(200);
  });
});
