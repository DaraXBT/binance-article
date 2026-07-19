import type { ReactNode } from 'react';

import { requireActivePageUser } from '@/server/auth/page-authorization';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  await requireActivePageUser('/settings/connections');
  return children;
}
