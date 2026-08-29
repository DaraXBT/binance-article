import type { ReactNode } from 'react';

import { requireActivePageUser } from '@/server/auth/page-authorization';

/** `/new` only redirects, but keeps its established private-page boundary. */
export default async function NewArticleLayout({ children }: { children: ReactNode }) {
  await requireActivePageUser('/new');
  return children;
}
