import { AppError } from '@/server/http/errors';
import { logEvent } from '@/server/http/log';

const MAX_REDIRECTS = 3;
const MAX_URL_CHARACTERS = 2_048;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 256 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HTML_MEDIA_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const EXCLUDED_ELEMENTS = new Set([
  'aside',
  'canvas',
  'footer',
  'form',
  'header',
  'iframe',
  'menu',
  'nav',
  'noscript',
  'object',
  'script',
  'style',
  'svg',
  'template',
]);
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

type TextBuffer = {
  chunks: string[];
  length: number;
};

type HtmlTag = {
  name: string;
  closing: boolean;
  selfClosing: boolean;
};

function appError(code: string, message: string) {
  return new AppError({ code, message, status: 400 });
}

function unsafeSourceUrl(family?: 4 | 6): never {
  logEvent('warn', 'ssrf.blocked_target', family ? { family } : {});
  throw appError(
    'UNSAFE_SOURCE_URL',
    'The source URL targets a private or reserved network.'
  );
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const parts = hostname.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => part < 0 || part > 255)) return null;
  return parts as [number, number, number, number];
}

function isBlockedIpv4([a, b, c]: [number, number, number, number]) {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function parseIpv6(hostname: string): number[] | null {
  const address = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (!address.includes(':') || address.includes('%')) return null;

  const halves = address.split('::');
  if (halves.length > 2) return null;

  const parseHalf = (half: string) => {
    if (!half) return [];
    const words = half.split(':');
    if (words.some((word) => !/^[0-9a-f]{1,4}$/i.test(word))) return null;
    return words.map((word) => Number.parseInt(word, 16));
  };

  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? '');
  if (!left || !right) return null;

  if (halves.length === 1) return left.length === 8 ? left : null;
  const zeroCount = 8 - left.length - right.length;
  if (zeroCount < 1) return null;
  return [...left, ...new Array<number>(zeroCount).fill(0), ...right];
}

function isBlockedIpv6(words: number[]) {
  const [a, b, c, d, , f] = words;
  const firstSixAreZero = words.slice(0, 6).every((word) => word === 0);
  const firstFiveAreZero = words.slice(0, 5).every((word) => word === 0);

  return (
    firstSixAreZero ||
    (firstFiveAreZero && f === 0xffff) ||
    (a === 0x0064 && b === 0xff9b && words.slice(2, 6).every((word) => word === 0)) ||
    (a === 0x0064 && b === 0xff9b && c === 0x0001) ||
    (a === 0x0100 && b === 0 && c === 0 && d === 0) ||
    (a === 0x2001 && b <= 0x01ff) ||
    (a === 0x2001 && b === 0x0db8) ||
    a === 0x2002 ||
    (a & 0xfff0) === 0x3ff0 ||
    (a & 0xfe00) === 0xfc00 ||
    (a & 0xffc0) === 0xfe80 ||
    (a & 0xffc0) === 0xfec0 ||
    (a & 0xff00) === 0xff00
  );
}

function assertPublicTarget(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (!normalized) throw appError('INVALID_SOURCE_URL', 'The source URL hostname is missing.');

  const ipv4 = parseIpv4(normalized);
  if (ipv4) {
    if (isBlockedIpv4(ipv4)) unsafeSourceUrl(4);
    return;
  }

  if (normalized.includes(':')) {
    const ipv6 = parseIpv6(normalized);
    if (!ipv6) throw appError('INVALID_SOURCE_URL', 'The source URL hostname is invalid.');
    if (isBlockedIpv6(ipv6)) unsafeSourceUrl(6);
    return;
  }

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  ) {
    unsafeSourceUrl();
  }
}

function assertHttpsUrl(value: string, base?: URL) {
  if (!value || value.length > MAX_URL_CHARACTERS) {
    throw appError('INVALID_SOURCE_URL', 'The source URL is invalid.');
  }

  let parsed: URL;
  try {
    parsed = base ? new URL(value, base) : new URL(value);
  } catch {
    throw appError('INVALID_SOURCE_URL', 'The source URL is invalid.');
  }

  if (parsed.href.length > MAX_URL_CHARACTERS) {
    throw appError('INVALID_SOURCE_URL', 'The source URL is invalid.');
  }
  if (parsed.protocol !== 'https:') {
    throw appError('UNSUPPORTED_SOURCE_URL', 'Only HTTPS source URLs are allowed.');
  }
  if (parsed.username || parsed.password) {
    throw appError(
      'UNSUPPORTED_SOURCE_URL',
      'URLs with embedded credentials are not allowed.'
    );
  }

  parsed.hash = '';
  assertPublicTarget(parsed.hostname);
  return parsed;
}

async function cancelBody(response: Response) {
  await response.body?.cancel().catch(() => undefined);
}

async function readBody(response: Response) {
  const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await cancelBody(response);
    throw appError('SOURCE_TOO_LARGE', 'The source URL response is too large to import.');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw appError('SOURCE_TOO_LARGE', 'The source URL response is too large to import.');
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function appendBounded(buffer: TextBuffer, value: string) {
  if (!value || buffer.length >= MAX_EXTRACTED_CHARACTERS) return;
  const remaining = MAX_EXTRACTED_CHARACTERS - buffer.length;
  const bounded = value.slice(0, remaining);
  buffer.chunks.push(bounded);
  buffer.length += bounded.length;
}

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return value.replace(
    /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z][a-z0-9]{1,31}));/gi,
    (match, decimal: string | undefined, hexadecimal: string | undefined, name: string | undefined) => {
      if (name) return namedEntities[name.toLowerCase()] ?? match;

      const codePoint = Number.parseInt(decimal ?? hexadecimal ?? '', hexadecimal ? 16 : 10);
      if (
        !Number.isInteger(codePoint) ||
        codePoint <= 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return ' ';
      }
      return String.fromCodePoint(codePoint);
    }
  );
}

function normalizeReadableText(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findTagEnd(html: string, start: number) {
  let quote: '"' | "'" | null = null;

  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') return index;
  }
  return -1;
}

function parseHtmlTag(source: string): HtmlTag | null {
  const match = source.match(/^\s*(\/)?\s*([a-z][a-z0-9:-]*)/i);
  if (!match) return null;

  const name = match[2].toLowerCase();
  return {
    name,
    closing: Boolean(match[1]),
    selfClosing: VOID_ELEMENTS.has(name) || /\/\s*$/.test(source),
  };
}

function extractReadableText(html: string) {
  const root: TextBuffer = { chunks: [], length: 0 };
  const body: TextBuffer = { chunks: [], length: 0 };
  const main: TextBuffer = { chunks: [], length: 0 };
  const article: TextBuffer = { chunks: [], length: 0 };
  const excludedStack: string[] = [];
  let bodyDepth = 0;
  let mainDepth = 0;
  let articleDepth = 0;
  let index = 0;

  const append = (value: string) => {
    if (excludedStack.length > 0) return;
    const decoded = decodeHtmlEntities(value);
    appendBounded(root, decoded);
    if (bodyDepth > 0) appendBounded(body, decoded);
    if (mainDepth > 0) appendBounded(main, decoded);
    if (articleDepth > 0) appendBounded(article, decoded);
  };

  while (index < html.length) {
    const tagStart = html.indexOf('<', index);
    if (tagStart < 0) {
      append(html.slice(index));
      break;
    }

    append(html.slice(index, tagStart));

    if (html.startsWith('<!--', tagStart)) {
      const commentEnd = html.indexOf('-->', tagStart + 4);
      if (commentEnd < 0) break;
      append(' ');
      index = commentEnd + 3;
      continue;
    }

    const tagEnd = findTagEnd(html, tagStart + 1);
    if (tagEnd < 0) break;
    const tag = parseHtmlTag(html.slice(tagStart + 1, tagEnd));
    index = tagEnd + 1;
    if (!tag) {
      append(' ');
      continue;
    }

    if (excludedStack.length > 0) {
      const activeExcludedTag = excludedStack[excludedStack.length - 1];
      if (tag.closing && tag.name === activeExcludedTag) {
        excludedStack.pop();
        if (excludedStack.length === 0) append(' ');
      } else if (!tag.closing && !tag.selfClosing && EXCLUDED_ELEMENTS.has(tag.name)) {
        excludedStack.push(tag.name);
      }
      continue;
    }

    if (tag.closing) {
      append(' ');
      if (tag.name === 'article') articleDepth = Math.max(0, articleDepth - 1);
      if (tag.name === 'main') mainDepth = Math.max(0, mainDepth - 1);
      if (tag.name === 'body') bodyDepth = Math.max(0, bodyDepth - 1);
      continue;
    }

    if (EXCLUDED_ELEMENTS.has(tag.name)) {
      append(' ');
      if (!tag.selfClosing) excludedStack.push(tag.name);
      continue;
    }

    if (!tag.selfClosing) {
      if (tag.name === 'body') bodyDepth += 1;
      if (tag.name === 'main') mainDepth += 1;
      if (tag.name === 'article') articleDepth += 1;
    }
    append(' ');
  }

  const preferred = [article, main, body, root]
    .map((buffer) => normalizeReadableText(buffer.chunks.join('')))
    .find((value) => value.length > 0);
  return preferred ?? '';
}

function mediaType(response: Response) {
  return response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
}

export async function fetchArticleSourceText(input: string) {
  let currentUrl = assertHttpsUrl(input);
  let redirectCount = 0;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    while (true) {
      const response = await fetch(currentUrl.href, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Accept: 'text/html,text/plain,application/xhtml+xml',
          'User-Agent': 'xArticleBot/1.0',
        },
        signal: controller.signal,
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        await cancelBody(response);
        if (redirectCount >= MAX_REDIRECTS) {
          logEvent('warn', 'ssrf.too_many_redirects', {
            hostname: currentUrl.hostname,
            redirectCount,
          });
          throw appError('TOO_MANY_REDIRECTS', 'The source URL redirected too many times.');
        }

        const location = response.headers.get('location');
        if (!location) {
          logEvent('warn', 'ssrf.invalid_redirect', {
            hostname: currentUrl.hostname,
            status: response.status,
          });
          throw appError('SOURCE_REDIRECT_FAILED', 'The source URL redirect is invalid.');
        }

        currentUrl = assertHttpsUrl(location, currentUrl);
        redirectCount += 1;
        continue;
      }

      if (!response.ok) {
        await cancelBody(response);
        throw appError('SOURCE_FETCH_FAILED', 'The source URL could not be fetched.');
      }

      const responseMediaType = mediaType(response);
      if (responseMediaType !== 'text/plain' && !HTML_MEDIA_TYPES.has(responseMediaType)) {
        await cancelBody(response);
        throw appError(
          'UNSUPPORTED_SOURCE_CONTENT',
          'The source URL must return HTML or plain text.'
        );
      }

      const rawText = await readBody(response);
      const extracted = responseMediaType === 'text/plain'
        ? normalizeReadableText(rawText).slice(0, MAX_EXTRACTED_CHARACTERS)
        : extractReadableText(rawText);

      if (extracted.length < 100) {
        throw appError(
          'SOURCE_CONTENT_TOO_SHORT',
          'The source URL did not contain enough readable content.'
        );
      }

      return extracted;
    }
  } catch (error) {
    if (error instanceof AppError) throw error;

    throw appError(
      'SOURCE_FETCH_FAILED',
      controller.signal.aborted
        ? 'The source URL request timed out.'
        : 'The source URL could not be fetched safely.'
    );
  } finally {
    clearTimeout(timeout);
  }
}
