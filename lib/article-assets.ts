export type ArticleBlobAccess = 'public' | 'private';

const VERCEL_BLOB_HOST_SUFFIX = '.blob.vercel-storage.com';

export function extractArticleAssetFilename(storedImageUrl: string): string {
  const parsed = new URL(storedImageUrl);
  const encodedFilename = parsed.pathname.split('/').filter(Boolean).at(-1);

  if (!encodedFilename) {
    throw new Error('Stored image URL does not include a filename');
  }

  return decodeURIComponent(encodedFilename);
}

export function buildArticleSlideAssetUrl(
  articleId: string,
  storedImageUrl: string,
  options?: { download?: boolean }
): string {
  const filename = extractArticleAssetFilename(storedImageUrl);
  const url = `/api/articles/${encodeURIComponent(articleId)}/assets/${encodeURIComponent(filename)}`;

  if (options?.download) {
    return `${url}?download=1`;
  }

  return url;
}

export function inferBlobAccess(storedImageUrl: string): ArticleBlobAccess {
  const parsed = new URL(storedImageUrl);

  if (!parsed.hostname.endsWith(VERCEL_BLOB_HOST_SUFFIX)) {
    throw new Error('Stored image URL is not a Vercel Blob URL');
  }

  if (parsed.hostname.includes('.private.blob.vercel-storage.com')) {
    return 'private';
  }

  return 'public';
}
