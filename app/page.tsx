import { redirect } from 'next/navigation';

import { PublicHome } from '@/components/home/public-home';
import { getOptionalActivePageUser } from '@/server/auth/page-authorization';

export default async function HomePage() {
  const actor = await getOptionalActivePageUser();
  if (actor) redirect('/workspace');
  return <PublicHome />;
}
