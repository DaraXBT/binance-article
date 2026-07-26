export const ARTICLE_ASSET_REFERENCE_SCHEME = 'r2:';
export const ARTICLE_ASSET_REFERENCE_HOST = 'article-assets';

const IdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

function assertIdentifier(value: string): string {
  if (!IdentifierPattern.test(value)) throw new Error('Invalid private article asset reference.');
  return value;
}

function assertFilename(value: string): string {
  if (
    value.length < 1 || value.length > 200 || value !== value.trim() ||
    value === '.' || value === '..' || /[\\/\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error('Invalid private article asset filename.');
  }
  return value;
}

export function createArticleAssetReference(assetId: string, filename: string): string {
  return `r2://${ARTICLE_ASSET_REFERENCE_HOST}/${assertIdentifier(assetId)}/${encodeURIComponent(
    assertFilename(filename),
  )}`;
}

export function parseArticleAssetReference(reference: string): {
  assetId: string;
  filename: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(reference);
  } catch {
    throw new Error('Invalid private article asset reference.');
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (
    parsed.protocol !== ARTICLE_ASSET_REFERENCE_SCHEME ||
    parsed.hostname !== ARTICLE_ASSET_REFERENCE_HOST ||
    parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash ||
    segments.length !== 2
  ) {
    throw new Error('Invalid private article asset reference.');
  }
  try {
    return {
      assetId: assertIdentifier(decodeURIComponent(segments[0])),
      filename: assertFilename(decodeURIComponent(segments[1])),
    };
  } catch {
    throw new Error('Invalid private article asset reference.');
  }
}

export function extractArticleAssetFilename(storedImageUrl: string): string {
  return parseArticleAssetReference(storedImageUrl).filename;
}

export function buildArticleSlideAssetUrl(
  articleId: string,
  storedImageUrl: string,
  options?: { download?: boolean },
): string {
  // Keyed by the stable assetId: filenames like slide-3.png repeat after a
  // delete-plus-regenerate reorder, so they cannot address assets uniquely.
  const { assetId } = parseArticleAssetReference(storedImageUrl);
  const url = `/api/articles/${encodeURIComponent(articleId)}/assets/${encodeURIComponent(assetId)}`;
  return options?.download ? `${url}?download=1` : url;
}
