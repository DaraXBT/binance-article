import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { assertTrustedMutationOrigin } from './origin';

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
