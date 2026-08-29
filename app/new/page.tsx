import { redirect } from 'next/navigation';

import { isArticleSource } from '@/lib/article-source';

/** Legacy entry point kept for bookmarks and shared links. */
export default async function NewArticlePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const params = await searchParams;
  const mode = typeof params.mode === 'string' ? params.mode : null;
  const source = isArticleSource(mode) ? mode : 'prompt';

  redirect(source === 'prompt' ? '/workspace' : `/workspace?source=${source}`);
}
