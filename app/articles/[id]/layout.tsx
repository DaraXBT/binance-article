import type { ReactNode } from 'react';

import { requireActivePageUser } from '@/server/auth/page-authorization';

export default async function ArticleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireActivePageUser(`/articles/${encodeURIComponent(id)}`);
  return children;
}
