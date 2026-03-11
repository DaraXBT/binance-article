import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/server/http/errors';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

vi.mock('cheerio', () => ({
  load: vi.fn((html: string) => {
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const $ = Object.assign(() => ({ text: () => text, remove: () => {} }), {
      root: () => ({ text: () => text }),
    });
    return $;
  }),
}));

import { lookup } from 'node:dns/promises';

const lookupMock = vi.mocked(lookup);

function mockDnsLookup(address: string, family: 4 | 6 = 4) {
  lookupMock.mockResolvedValue([{ address, family }] as never);
}

function htmlBody(text: string) {
  return `<html><body><article>${text}</article></body></html>`;
}

const LONG_TEXT = 'A'.repeat(200);
const VALID_HTML = htmlBody(LONG_TEXT);

function mockFetchOk(body = VALID_HTML, contentType = 'text/html; charset=utf-8') {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(body);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: {
          'content-type': contentType,
          'content-length': String(encoded.byteLength),
        },
      })
    )
  );
}

function mockFetchRedirect(location: string | null, status = 302) {
  const headers = new Headers();
  if (location) headers.set('location', location);

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(null, { status, headers })
    )
  );
}

async function expectAppError(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
    expect.unreachable('Expected AppError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

describe('fetchArticleSourceText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockDnsLookup('93.184.216.34');
  });

  async function fetchArticle(url: string) {
    const mod = await import('@/server/integrations/url-fetch');
    return mod.fetchArticleSourceText(url);
  }

  describe('HTTPS-only validation', () => {
    it('rejects http:// URLs', async () => {
      await expectAppError(() => fetchArticle('http://example.com'), 'UNSUPPORTED_SOURCE_URL');
    });

    it('rejects ftp:// URLs', async () => {
      await expectAppError(() => fetchArticle('ftp://example.com/file'), 'UNSUPPORTED_SOURCE_URL');
    });

    it('rejects data: URLs', async () => {
      await expectAppError(() => fetchArticle('data:text/html,<h1>hi</h1>'), 'UNSUPPORTED_SOURCE_URL');
    });

    it('rejects javascript: URLs', async () => {
      await expectAppError(() => fetchArticle('javascript:alert(1)'), 'UNSUPPORTED_SOURCE_URL');
    });

    it('rejects invalid URLs', async () => {
      await expectAppError(() => fetchArticle('not-a-url'), 'INVALID_SOURCE_URL');
    });

    it('accepts https:// URLs', async () => {
      mockFetchOk();
      const result = await fetchArticle('https://example.com/article');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('embedded credentials', () => {
    it('rejects URLs with username', async () => {
      await expectAppError(
        () => fetchArticle('https://user@example.com/path'),
        'UNSUPPORTED_SOURCE_URL'
      );
    });

    it('rejects URLs with username and password', async () => {
      await expectAppError(
        () => fetchArticle('https://user:pass@example.com/path'),
        'UNSUPPORTED_SOURCE_URL'
      );
    });
  });

  describe('private IPv4 blocking', () => {
    const blockedIpv4 = [
      ['127.0.0.1', 'loopback'],
      ['127.255.255.255', 'loopback high'],
      ['10.0.0.1', '10.x private'],
      ['10.255.255.255', '10.x private high'],
      ['172.16.0.1', '172.16.x private'],
      ['172.31.255.255', '172.31.x private'],
      ['192.168.0.1', '192.168.x private'],
      ['192.168.255.255', '192.168.x private high'],
      ['169.254.1.1', 'link-local'],
      ['0.0.0.0', 'unspecified'],
      ['0.1.2.3', '0.x reserved'],
      ['100.64.0.1', 'shared address space'],
      ['100.127.255.255', 'shared address space high'],
      ['192.0.0.1', '192.0.x reserved'],
      ['198.18.0.1', 'benchmark testing'],
      ['198.19.0.1', 'benchmark testing 2'],
      ['224.0.0.1', 'multicast'],
      ['255.255.255.255', 'broadcast'],
    ];

    for (const [ip, label] of blockedIpv4) {
      it(`blocks ${ip} (${label})`, async () => {
        mockDnsLookup(ip, 4);
        mockFetchOk();
        await expectAppError(() => fetchArticle('https://evil.com'), 'UNSAFE_SOURCE_URL');
      });
    }
  });

  describe('private IPv6 blocking', () => {
    const blockedIpv6 = [
      ['::1', 'loopback'],
      ['::', 'unspecified'],
      ['fc00::1', 'unique local fc'],
      ['fd00::1', 'unique local fd'],
      ['fe80::1', 'link-local'],
      ['ff01::1', 'multicast'],
      ['ff02::1', 'multicast link-local'],
    ];

    for (const [ip, label] of blockedIpv6) {
      it(`blocks ${ip} (${label})`, async () => {
        mockDnsLookup(ip, 6);
        mockFetchOk();
        await expectAppError(() => fetchArticle('https://evil.com'), 'UNSAFE_SOURCE_URL');
      });
    }
  });

  describe('DNS rebinding protection', () => {
    it('rejects hostname that resolves to private IPv4', async () => {
      lookupMock.mockResolvedValue([
        { address: '192.168.1.1', family: 4 },
      ] as never);
      mockFetchOk();
      await expectAppError(() => fetchArticle('https://rebind.example.com'), 'UNSAFE_SOURCE_URL');
    });

    it('rejects hostname that resolves to private IPv6', async () => {
      lookupMock.mockResolvedValue([
        { address: '::1', family: 6 },
      ] as never);
      mockFetchOk();
      await expectAppError(() => fetchArticle('https://rebind.example.com'), 'UNSAFE_SOURCE_URL');
    });

    it('rejects when any resolved address is private (mixed)', async () => {
      lookupMock.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '::1', family: 6 },
      ] as never);
      mockFetchOk();
      await expectAppError(() => fetchArticle('https://mixed.example.com'), 'UNSAFE_SOURCE_URL');
    });

    it('rejects when DNS lookup returns no addresses', async () => {
      lookupMock.mockResolvedValue([] as never);
      mockFetchOk();
      await expectAppError(() => fetchArticle('https://no-records.example.com'), 'SOURCE_LOOKUP_FAILED');
    });
  });

  describe('redirect handling', () => {
    it('rejects redirect to http://', async () => {
      mockDnsLookup('93.184.216.34');
      mockFetchRedirect('http://example.com/page');
      await expectAppError(() => fetchArticle('https://example.com'), 'UNSUPPORTED_SOURCE_URL');
    });

    it('rejects redirect to private IP', async () => {
      let callCount = 0;
      lookupMock.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return [{ address: '93.184.216.34', family: 4 }] as never;
        return [{ address: '127.0.0.1', family: 4 }] as never;
      });

      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce(
            new Response(null, {
              status: 302,
              headers: { location: 'https://internal.example.com/secret' },
            })
          )
          .mockResolvedValueOnce(
            new Response(VALID_HTML, {
              status: 200,
              headers: { 'content-type': 'text/html' },
            })
          )
      );

      await expectAppError(() => fetchArticle('https://example.com'), 'UNSAFE_SOURCE_URL');
    });

    it('rejects redirect without location header', async () => {
      mockFetchRedirect(null);
      await expectAppError(() => fetchArticle('https://example.com'), 'SOURCE_REDIRECT_FAILED');
    });

    it('rejects after too many redirects', async () => {
      mockDnsLookup('93.184.216.34');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async () =>
          new Response(null, {
            status: 302,
            headers: { location: 'https://example.com/next' },
          })
        )
      );
      await expectAppError(() => fetchArticle('https://example.com'), 'TOO_MANY_REDIRECTS');
    });

    it('follows valid HTTPS redirect to public IP', async () => {
      mockDnsLookup('93.184.216.34');
      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce(
            new Response(null, {
              status: 301,
              headers: { location: 'https://example.com/final' },
            })
          )
          .mockResolvedValueOnce(
            new Response(VALID_HTML, {
              status: 200,
              headers: { 'content-type': 'text/html' },
            })
          )
      );

      const result = await fetchArticle('https://example.com');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('content-type validation', () => {
    it('rejects application/json', async () => {
      mockFetchOk('{}', 'application/json');
      await expectAppError(() => fetchArticle('https://example.com'), 'UNSUPPORTED_SOURCE_CONTENT');
    });

    it('rejects application/pdf', async () => {
      mockFetchOk('%PDF-1.4', 'application/pdf');
      await expectAppError(() => fetchArticle('https://example.com'), 'UNSUPPORTED_SOURCE_CONTENT');
    });

    it('rejects image/png', async () => {
      mockFetchOk('binary', 'image/png');
      await expectAppError(() => fetchArticle('https://example.com'), 'UNSUPPORTED_SOURCE_CONTENT');
    });

    it('accepts text/html', async () => {
      mockFetchOk(VALID_HTML, 'text/html; charset=utf-8');
      const result = await fetchArticle('https://example.com');
      expect(result.length).toBeGreaterThan(0);
    });

    it('accepts text/plain', async () => {
      mockFetchOk(LONG_TEXT, 'text/plain');
      const result = await fetchArticle('https://example.com');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('response size limit', () => {
    it('rejects when content-length exceeds limit', async () => {
      mockDnsLookup('93.184.216.34');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('small body', {
            status: 200,
            headers: {
              'content-type': 'text/html',
              'content-length': String(3 * 1024 * 1024),
            },
          })
        )
      );
      await expectAppError(() => fetchArticle('https://example.com'), 'SOURCE_TOO_LARGE');
    });

    it('rejects when streamed body exceeds limit', async () => {
      mockDnsLookup('93.184.216.34');

      const chunkSize = 512 * 1024;
      const totalChunks = 6; // 3MB total, exceeds 2MB limit
      let chunksSent = 0;
      const stream = new ReadableStream({
        pull(controller) {
          if (chunksSent < totalChunks) {
            controller.enqueue(new Uint8Array(chunkSize));
            chunksSent++;
          } else {
            controller.close();
          }
        },
      });

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
        )
      );

      await expectAppError(() => fetchArticle('https://example.com'), 'SOURCE_TOO_LARGE');
    });
  });

  describe('HTTP error responses', () => {
    it('rejects on 404', async () => {
      mockDnsLookup('93.184.216.34');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }))
      );
      await expectAppError(() => fetchArticle('https://example.com'), 'SOURCE_FETCH_FAILED');
    });

    it('rejects on 500', async () => {
      mockDnsLookup('93.184.216.34');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('Error', { status: 500 }))
      );
      await expectAppError(() => fetchArticle('https://example.com'), 'SOURCE_FETCH_FAILED');
    });
  });

  describe('content length validation', () => {
    it('rejects content shorter than 100 characters', async () => {
      mockFetchOk(htmlBody('short'), 'text/html');
      await expectAppError(() => fetchArticle('https://example.com'), 'SOURCE_CONTENT_TOO_SHORT');
    });
  });
});
