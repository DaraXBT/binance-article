import type { ReactNode } from 'react';

import { requireActivePageUser } from '@/server/auth/page-authorization';

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  await requireActivePageUser('/workspace');
  return children;
}
