import { redirect } from 'next/navigation';

import { AuthPage } from '@/components/auth-page';
import { AuthErrorPanel } from '@/components/auth/auth-error-panel';
import { PublicHome } from '@/components/home/public-home';
import { getOptionalActivePageUser } from '@/server/auth/page-authorization';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const params = await searchParams;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const actor = await getOptionalActivePageUser();
  if (actor) redirect('/workspace');
  if (error) {
    return (
      <AuthPage>
        <AuthErrorPanel error={error} context="sign-in" />
      </AuthPage>
    );
  }
  return <PublicHome />;
}
