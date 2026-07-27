import type { ReactNode } from 'react';

import { requireActivePageUser } from '@/server/auth/page-authorization';

// Keep legacy bookmarks authenticated before forwarding them into the
// workspace-owned settings dialog.
export default async function ConnectionsLayout({ children }: { children: ReactNode }) {
  await requireActivePageUser('/workspace?settings=connections');
  return children;
}
