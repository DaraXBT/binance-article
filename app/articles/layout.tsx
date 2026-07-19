import type { ReactNode } from 'react';

import { requireActivePageUser } from '@/server/auth/page-authorization';

export default async function ArticlesLayout({ children }: { children: ReactNode }) {
  await requireActivePageUser('/');
  return children;
}
