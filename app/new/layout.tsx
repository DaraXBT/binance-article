import type { ReactNode } from 'react';

import { requireActivePageUser } from '@/server/auth/page-authorization';

export default async function NewArticleLayout({ children }: { children: ReactNode }) {
  await requireActivePageUser('/new');
  return children;
}
