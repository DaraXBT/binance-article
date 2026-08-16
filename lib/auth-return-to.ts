export const DEFAULT_AUTHENTICATED_DESTINATION = '/workspace';

/**
 * Accept only same-origin application paths for post-auth navigation.
 *
 * OAuth continuation values can cross several public pages, so this helper is
 * deliberately safe to use from both server and client components. Fragments
 * are omitted because they are not needed for application routing and may
 * contain browser-local bearer data.
 */
export function normalizeLoginCallback(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500) {
    return DEFAULT_AUTHENTICATED_DESTINATION;
  }
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return DEFAULT_AUTHENTICATED_DESTINATION;
  }
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded)) {
      return DEFAULT_AUTHENTICATED_DESTINATION;
    }
    const parsed = new URL(value, 'https://app.invalid');
    if (parsed.origin !== 'https://app.invalid') return DEFAULT_AUTHENTICATED_DESTINATION;
    // WHATWG URL parsing resolves dot segments. Validate the normalized path
    // as well as the raw value so `/foo/..//evil.example` cannot become a
    // scheme-relative OAuth callback after normalization.
    if (
      !parsed.pathname.startsWith('/') ||
      parsed.pathname.startsWith('//') ||
      /[\\\u0000-\u001f\u007f]/.test(parsed.pathname)
    ) {
      return DEFAULT_AUTHENTICATED_DESTINATION;
    }
    if (
      parsed.pathname === '/login' ||
      parsed.pathname.startsWith('/login/') ||
      parsed.pathname === '/join' ||
      parsed.pathname.startsWith('/join/')
    ) {
      return DEFAULT_AUTHENTICATED_DESTINATION;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return DEFAULT_AUTHENTICATED_DESTINATION;
  }
}
