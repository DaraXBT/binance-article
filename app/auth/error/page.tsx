import { AuthPage } from '@/components/auth-page';
import { AuthErrorPanel } from '@/components/auth/auth-error-panel';
import { normalizeLoginCallback } from '@/server/auth/page-authorization';

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[];
    flow?: string | string[];
    returnTo?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const flow = Array.isArray(params.flow) ? params.flow[0] : params.flow;
  const returnTo = normalizeLoginCallback(params.returnTo);

  return (
    <AuthPage>
      <AuthErrorPanel
        error={error ?? 'unknown'}
        context={flow === 'enrollment' ? 'join' : 'sign-in'}
        returnTo={returnTo}
      />
    </AuthPage>
  );
}
