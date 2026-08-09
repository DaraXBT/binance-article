import { AuthPage } from '@/components/auth-page';
import { AuthErrorPanel } from '@/components/auth/auth-error-panel';

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[];
    flow?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const flow = Array.isArray(params.flow) ? params.flow[0] : params.flow;

  return (
    <AuthPage>
      <AuthErrorPanel
        error={error ?? 'unknown'}
        context={flow === 'enrollment' ? 'join' : 'sign-in'}
      />
    </AuthPage>
  );
}
