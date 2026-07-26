import type { ReactNode } from 'react';

import { requireActivePageUser } from '@/server/auth/page-authorization';

// Scoped to the connections route so the post-login callback returns the
// user to the page they actually requested; new settings routes need their
// own layout with their own callback path.
export default async function ConnectionsLayout({ children }: { children: ReactNode }) {
  await requireActivePageUser('/settings/connections');
  return children;
}
