import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { assertAllowedOrigin, assertTrustedMutationOrigin } from './origin';

const canonicalOrigin = 'https://articles.example.com';

function request(headers: HeadersInit = {}) {
  return new NextRequest(`${canonicalOrigin}/api/enrollment/claim`, {
    method: 'POST',
    headers,
  });
}

describe('strict browser mutation origin policy', () => {
  it('accepts the configured canonical origin', () => {
    expect(() => assertTrustedMutationOrigin(request({
      origin: canonicalOrigin,
      'sec-fetch-site': 'same-origin',
    }), canonicalOrigin)).not.toThrow();
  });

  it('uses a same-origin referer only when Origin is unavailable', () => {
    expect(() => assertTrustedMutationOrigin(request({
      referer: `${canonicalOrigin}/join`,
      'sec-fetch-site': 'same-origin',
    }), canonicalOrigin)).not.toThrow();
  });

  it('rejects missing, malformed, cross-origin, and cross-site evidence', () => {
    for (const headers of [
      {},
      { origin: 'not-a-url' },
      { origin: 'https://evil.example' },
      { referer: 'https://evil.example/join' },
      { origin: canonicalOrigin, 'sec-fetch-site': 'cross-site' },
    ]) {
      expect(() => assertTrustedMutationOrigin(request(headers as HeadersInit), canonicalOrigin))
        .toThrow(expect.objectContaining({ code: 'CROSS_SITE_REQUEST_BLOCKED' }));
    }
  });

  it('rejects an invalid canonical origin instead of trusting the request host', () => {
    expect(() => assertTrustedMutationOrigin(request({ origin: canonicalOrigin }), 'not-a-url'))
      .toThrow(expect.objectContaining({ code: 'INVALID_ORIGIN_CONFIGURATION' }));
  });
});

describe('compatibility mutation origin policy', () => {
  it('uses the browser-requested host when Next has an internal URL origin', () => {
    const request = new NextRequest('http://localhost:3000/api/articles', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3100',
        origin: 'http://127.0.0.1:3100',
      },
    });

    expect(() => assertAllowedOrigin(request)).not.toThrow();
  });

  it('continues to reject a different browser origin', () => {
    const request = new NextRequest('http://localhost:3000/api/articles', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3100',
        origin: 'http://evil.example',
      },
    });

    expect(() => assertAllowedOrigin(request))
      .toThrow(expect.objectContaining({ code: 'CROSS_SITE_REQUEST_BLOCKED' }));
  });
});
