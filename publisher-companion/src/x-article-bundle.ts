import { extractV3PublicationBundle } from './v3-bundle';

export async function extractXArticlePublicationBundle(bundlePath: string): Promise<{
  bundleDir: string;
  articlePath: string;
  title: string;
  markdown: string;
  coverPath?: string;
  imagePaths: string[];
}> {
  const extracted = await extractV3PublicationBundle(bundlePath, {
    target: 'x',
    kind: 'article',
  });
  return {
    bundleDir: extracted.bundleDir,
    articlePath: extracted.contentPath,
    title: extracted.title ?? '',
    markdown: extracted.content,
    ...(extracted.coverPath ? { coverPath: extracted.coverPath } : {}),
    imagePaths: extracted.imagePaths,
  };
}
