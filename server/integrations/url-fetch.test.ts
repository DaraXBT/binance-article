import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/server/http/errors';

const { lookupMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
}));

// This keeps the legacy Node implementation deterministic until the Worker-native
// implementation removes DNS preflight entirely.
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

import { fetchArticleSourceText } from '@/server/integrations/url-fetch';

const PUBLIC_URL = 'https://93.184.216.34/article';
const LONG_TEXT = 'A'.repeat(200);
const VALID_HTML = `<html><body><article>${LONG_TEXT}</article></body></html>`;

function responseWithBody(body = VALID_HTML, contentType = 'text/html; charset=utf-8') {
  const encoded = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-length': String(encoded.byteLength),
    },
  });
}

function mockFetchOk(body = VALID_HTML, contentType = 'text/html; charset=utf-8') {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(responseWithBody(body, contentType));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function expectAppError(fn: () => Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(AppError);
  expect(caught).toMatchObject({ code });
  return caught as AppError;
}

describe('fetchArticleSourceText', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    'http://example.com',
    'ftp://example.com/file',
    'data:text/html,<h1>hi</h1>',
    'javascript:alert(1)',
  ])('rejects a non-HTTPS URL: %s', async (url) => {
    await expectAppError(() => fetchArticleSourceText(url), 'UNSUPPORTED_SOURCE_URL');
  });

  it('rejects invalid URLs and overlong URLs before fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await expectAppError(() => fetchArticleSourceText('not-a-url'), 'INVALID_SOURCE_URL');
    await expectAppError(
      () => fetchArticleSourceText(`https://example.com/${'a'.repeat(4_096)}`),
      'INVALID_SOURCE_URL'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'https://user@example.com/path',
    'https://user:pass@example.com/path',
  ])('rejects embedded credentials: %s', async (url) => {
    await expectAppError(() => fetchArticleSourceText(url), 'UNSUPPORTED_SOURCE_URL');
  });

  describe('literal private and reserved addresses', () => {
    const blockedUrls = [
      'https://127.0.0.1/',
      'https://10.0.0.1/',
      'https://169.254.1.1/',
      'https://192.168.0.1/',
      'https://203.0.113.1/',
      'https://2130706433/',
      'https://0x7f000001/',
      'https://127.1/',
      'https://0177.0.0.1/',
      'https://[::1]/',
      'https://[fe90::1]/',
      'https://[febf::1]/',
      'https://[::ffff:7f00:1]/',
      'https://[2001:db8::1]/',
    ];

    for (const url of blockedUrls) {
      it(`blocks ${url} without making a request`, async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(responseWithBody());
        vi.stubGlobal('fetch', fetchMock);

        await expectAppError(() => fetchArticleSourceText(url), 'UNSAFE_SOURCE_URL');
        expect(fetchMock).not.toHaveBeenCalled();
      });
    }

    it.each([
      'https://93.184.216.34/article',
      'https://[2606:4700:4700::1111]/article',
    ])('allows a public literal address: %s', async (url) => {
      mockFetchOk();
      await expect(fetchArticleSourceText(url)).resolves.toHaveLength(LONG_TEXT.length);
    });
  });

  describe('redirect handling', () => {
    it('revalidates a private IPv6 redirect before the second fetch', async () => {
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, {
          status: 302,
          headers: { location: 'https://[::1]/secret' },
        }))
        .mockResolvedValueOnce(responseWithBody());
      vi.stubGlobal('fetch', fetchMock);

      await expectAppError(() => fetchArticleSourceText(PUBLIC_URL), 'UNSAFE_SOURCE_URL');
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('rejects a redirect with embedded credentials', async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
        status: 302,
        headers: { location: 'https://user:password@example.com/private' },
      }));
      vi.stubGlobal('fetch', fetchMock);

      await expectAppError(() => fetchArticleSourceText(PUBLIC_URL), 'UNSUPPORTED_SOURCE_URL');
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('allows exactly three redirects and follows a relative target', async () => {
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/one' } }))
        .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/two' } }))
        .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: '/three' } }))
        .mockResolvedValueOnce(responseWithBody());
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchArticleSourceText(PUBLIC_URL)).resolves.toHaveLength(LONG_TEXT.length);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(String(fetchMock.mock.calls[3][0])).toBe('https://93.184.216.34/three');
    });

    it('rejects a fourth redirect and does not fetch its target', async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
        status: 308,
        headers: { location: '/again' },
      }));
      vi.stubGlobal('fetch', fetchMock);

      await expectAppError(() => fetchArticleSourceText(PUBLIC_URL), 'TOO_MANY_REDIRECTS');
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('cancels an unused redirect body before following the target', async () => {
      const cancel = vi.fn();
      const redirectBody = new ReadableStream<Uint8Array>({ cancel });
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(redirectBody, {
          status: 302,
          headers: { location: '/final' },
        }))
        .mockResolvedValueOnce(responseWithBody());
      vi.stubGlobal('fetch', fetchMock);

      await fetchArticleSourceText(PUBLIC_URL);
      expect(cancel).toHaveBeenCalledOnce();
    });
  });

  it('uses a credential-free manual fetch request and strips the fragment', async () => {
    const fetchMock = mockFetchOk();

    await fetchArticleSourceText(`${PUBLIC_URL}#private-fragment`);

    const [url, request] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(PUBLIC_URL);
    expect(request).toMatchObject({ redirect: 'manual' });
    // Cloudflare Workers have no ambient browser cookie jar and their
    // RequestInit intentionally does not expose the browser-only credentials field.
    expect(request).not.toHaveProperty('credentials');
    const headers = new Headers(request?.headers);
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('cookie')).toBe(false);
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  describe('content type validation', () => {
    it.each([
      'application/json',
      'application/pdf',
      'image/png',
      'application/not-text/html',
      'text/htmlx',
      '',
    ])('rejects unsupported or missing media type: %s', async (contentType) => {
      mockFetchOk(VALID_HTML, contentType);
      await expectAppError(
        () => fetchArticleSourceText(PUBLIC_URL),
        'UNSUPPORTED_SOURCE_CONTENT'
      );
    });

    it.each([
      'text/html; charset=utf-8',
      'TEXT/HTML; CHARSET=UTF-8',
      'application/xhtml+xml',
    ])('accepts HTML media type: %s', async (contentType) => {
      mockFetchOk(VALID_HTML, contentType);
      await expect(fetchArticleSourceText(PUBLIC_URL)).resolves.toHaveLength(LONG_TEXT.length);
    });

    it('accepts and normalizes plain text', async () => {
      mockFetchOk(`  ${'word \n\t'.repeat(30)}  `, 'text/plain; charset=utf-8');
      const result = await fetchArticleSourceText(PUBLIC_URL);
      expect(result).not.toMatch(/\s{2,}/);
      expect(result.length).toBeGreaterThanOrEqual(100);
    });
  });

  describe('bounded HTML extraction', () => {
    it('prefers article content and excludes active, chrome, and embedded elements', async () => {
      const core = `Chosen & safe # article ${'A'.repeat(120)} tail`;
      mockFetchOk(`<!doctype html>
        <html><body data-secret="ATTRIBUTE_SECRET">
          body marker
          <main>main marker
            <article>
              Chosen &amp; safe &#35; article
              <script>SCRIPT_SECRET</script><style>STYLE_SECRET</style>
              <nav>NAV_SECRET</nav><form>FORM_SECRET</form>
              <template>TEMPLATE_SECRET</template><iframe>IFRAME_SECRET</iframe>
              <object>OBJECT_SECRET</object><!-- COMMENT_SECRET -->
              <span>${'A'.repeat(120)}</span><strong>tail</strong>
            </article>
          </main>
        </body></html>`);

      const result = await fetchArticleSourceText(PUBLIC_URL);

      expect(result).toBe(core);
      expect(result).not.toMatch(/SECRET|body marker|main marker/);
    });

    it('preserves word boundaries between tags', async () => {
      mockFetchOk(`<article>${'A'.repeat(100)}<span>first</span><span>second</span></article>`);
      await expect(fetchArticleSourceText(PUBLIC_URL)).resolves.toMatch(/first second/);
    });

    it('caps extracted text even when the response is below the byte limit', async () => {
      mockFetchOk(`<article>${'A'.repeat(300_000)}</article>`);
      const result = await fetchArticleSourceText(PUBLIC_URL);
      expect(result.length).toBeLessThanOrEqual(256 * 1024);
    });
  });

  describe('response bounds and timeouts', () => {
    it('rejects a declared response larger than two MiB', async () => {
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('small', {
        status: 200,
        headers: {
          'content-type': 'text/html',
          'content-length': String(2 * 1024 * 1024 + 1),
        },
      })));

      await expectAppError(() => fetchArticleSourceText(PUBLIC_URL), 'SOURCE_TOO_LARGE');
    });

    it('cancels a streamed response as soon as it exceeds two MiB', async () => {
      const cancel = vi.fn();
      let chunks = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          chunks += 1;
          controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        },
        cancel,
      });
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })));

      await expectAppError(() => fetchArticleSourceText(PUBLIC_URL), 'SOURCE_TOO_LARGE');
      expect(chunks).toBeGreaterThanOrEqual(2);
      expect(cancel).toHaveBeenCalledOnce();
    });

    it('aborts a request that does not return headers within ten seconds', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation((_url, request) => (
        new Promise<Response>((_resolve, reject) => {
          request?.signal?.addEventListener('abort', () => {
            reject(new DOMException('secret details', 'AbortError'));
          }, { once: true });
        })
      )));

      const pending = expectAppError(
        () => fetchArticleSourceText(PUBLIC_URL),
        'SOURCE_FETCH_FAILED'
      );
      await vi.advanceTimersByTimeAsync(10_000);
      const error = await pending;
      expect(error.message).not.toContain('secret details');
    });
  });

  it.each([404, 500])('maps HTTP %s to a sanitized fetch error', async (status) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      new Response('private provider response', { status })
    ));
    const error = await expectAppError(
      () => fetchArticleSourceText(PUBLIC_URL),
      'SOURCE_FETCH_FAILED'
    );
    expect(error.message).not.toContain('private provider response');
  });

  it('rejects extracted content shorter than 100 characters', async () => {
    mockFetchOk('<html><body><article>short</article></body></html>');
    await expectAppError(
      () => fetchArticleSourceText(PUBLIC_URL),
      'SOURCE_CONTENT_TOO_SHORT'
    );
  });

  it('never logs URL paths, query credentials, or fragments', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: '/again' },
    })));

    await expectAppError(
      () => fetchArticleSourceText('https://93.184.216.34/private?token=DO_NOT_LOG#secret'),
      'TOO_MANY_REDIRECTS'
    );

    const serializedLogs = warning.mock.calls.flat().join(' ');
    expect(serializedLogs).not.toContain('DO_NOT_LOG');
    expect(serializedLogs).not.toContain('/private');
    expect(serializedLogs).not.toContain('#secret');
  });
});
