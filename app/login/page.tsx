import { AuthPage } from '@/components/auth-page';
import { AuthErrorPanel } from '@/components/auth/auth-error-panel';
import { LoginForm } from '@/components/auth/login-form';
import { normalizeLoginCallback } from '@/server/auth/page-authorization';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackURL?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const callbackURL = normalizeLoginCallback(params.callbackURL);
  const error = Array.isArray(params.error) ? params.error[0] : params.error;

  return (
    <AuthPage>
      <div className="w-full">
        <AuthErrorPanel
          error={error}
          context="sign-in"
          className="mb-5"
          showAction={error !== 'account_disabled'}
        />
        <LoginForm callbackURL={callbackURL} />
      </div>
    </AuthPage>
  );
}
