export const ARTICLE_SOURCES = ['prompt', 'text', 'url'] as const;

export type ArticleSource = (typeof ARTICLE_SOURCES)[number];

export function isArticleSource(value: string | null | undefined): value is ArticleSource {
  return ARTICLE_SOURCES.some((source) => source === value);
}

/**
 * Matches the server's URL-generation contract before a request is made.
 * The server schema remains the authority for every submitted value.
 */
export function normalizeImportUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 2_048) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.username || url.password) return null;
  url.hash = '';
  return url.href;
}
