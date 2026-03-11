import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { load } from 'cheerio';

import { AppError } from '@/server/http/errors';
import { logEvent } from '@/server/http/log';

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

function assertHttpsUrl(value: string, base?: URL) {
  let parsed: URL;

  try {
    parsed = base ? new URL(value, base) : new URL(value);
  } catch {
    throw new AppError({
      code: 'INVALID_SOURCE_URL',
      message: 'The source URL is invalid.',
      status: 400,
    });
  }

  if (parsed.protocol !== 'https:') {
    throw new AppError({
      code: 'UNSUPPORTED_SOURCE_URL',
      message: 'Only HTTPS source URLs are allowed.',
      status: 400,
    });
  }

  if (parsed.username || parsed.password) {
    throw new AppError({
      code: 'UNSUPPORTED_SOURCE_URL',
      message: 'URLs with embedded credentials are not allowed.',
      status: 400,
    });
  }

  return parsed;
}

function isBlockedIpv4(address: string) {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10));

  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return true;
  }

  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string) {
  const normalized = address.toLowerCase();

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80') ||
    normalized.startsWith('ff')
  );
}

function assertPublicIpAddress(address: string) {
  const family = isIP(address);

  if (family === 4 && isBlockedIpv4(address)) {
    logEvent('warn', 'ssrf.blocked_ip', { address, family: 4 });
    throw new AppError({
      code: 'UNSAFE_SOURCE_URL',
      message: 'The source URL resolves to a private or reserved network.',
      status: 400,
    });
  }

  if (family === 6 && isBlockedIpv6(address)) {
    logEvent('warn', 'ssrf.blocked_ip', { address, family: 6 });
    throw new AppError({
      code: 'UNSAFE_SOURCE_URL',
      message: 'The source URL resolves to a private or reserved network.',
      status: 400,
    });
  }
}

async function assertPublicHostname(hostname: string) {
  if (!hostname) {
    throw new AppError({
      code: 'INVALID_SOURCE_URL',
      message: 'The source URL hostname is missing.',
      status: 400,
    });
  }

  if (isIP(hostname)) {
    assertPublicIpAddress(hostname);
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });

  if (addresses.length === 0) {
    throw new AppError({
      code: 'SOURCE_LOOKUP_FAILED',
      message: 'The source URL could not be resolved.',
      status: 400,
    });
  }

  for (const entry of addresses) {
    assertPublicIpAddress(entry.address);
  }
}

async function readBody(response: Response) {
  const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);

  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new AppError({
      code: 'SOURCE_TOO_LARGE',
      message: 'The source URL response is too large to import.',
      status: 400,
    });
  }

  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > MAX_RESPONSE_BYTES) {
      throw new AppError({
        code: 'SOURCE_TOO_LARGE',
        message: 'The source URL response is too large to import.',
        status: 400,
      });
    }

    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

function extractReadableText(html: string) {
  const $ = load(html);
  $('script, style, noscript, svg, nav, header, footer, aside, form').remove();

  const articleText = $('article').text().trim();
  const mainText = $('main').text().trim();
  const bodyText = $('body').text().trim();
  const selected = articleText || mainText || bodyText || $.root().text();

  return selected.replace(/\s+/g, ' ').trim();
}

export async function fetchArticleSourceText(input: string) {
  let currentUrl = assertHttpsUrl(input);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertPublicHostname(currentUrl.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(currentUrl, {
        redirect: 'manual',
        headers: {
          Accept: 'text/html,text/plain,application/xhtml+xml',
          'User-Agent': 'xArticleBot/1.0',
        },
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');

        if (!location) {
          logEvent('warn', 'ssrf.invalid_redirect', { url: currentUrl.href, status: response.status });
          throw new AppError({
            code: 'SOURCE_REDIRECT_FAILED',
            message: 'The source URL redirect is invalid.',
            status: 400,
          });
        }

        currentUrl = assertHttpsUrl(location, currentUrl);
        continue;
      }

      if (!response.ok) {
        throw new AppError({
          code: 'SOURCE_FETCH_FAILED',
          message: 'The source URL could not be fetched.',
          status: 400,
        });
      }

      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        throw new AppError({
          code: 'UNSUPPORTED_SOURCE_CONTENT',
          message: 'The source URL must return HTML or plain text.',
          status: 400,
        });
      }

      const rawText = await readBody(response);
      const extracted = contentType.includes('text/plain')
        ? rawText.replace(/\s+/g, ' ').trim()
        : extractReadableText(rawText);

      if (extracted.length < 100) {
        throw new AppError({
          code: 'SOURCE_CONTENT_TOO_SHORT',
          message: 'The source URL did not contain enough readable content.',
          status: 400,
        });
      }

      return extracted;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError({
        code: 'SOURCE_FETCH_FAILED',
        message: 'The source URL could not be fetched safely.',
        status: 400,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  logEvent('warn', 'ssrf.too_many_redirects', { url: input });
  throw new AppError({
    code: 'TOO_MANY_REDIRECTS',
    message: 'The source URL redirected too many times.',
    status: 400,
  });
}
