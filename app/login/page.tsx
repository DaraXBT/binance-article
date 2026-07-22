import { AuthPage } from '@/components/auth-page';
import { LoginForm } from '@/components/auth/login-form';
import { normalizeLoginCallback } from '@/server/auth/page-authorization';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackURL?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const callbackURL = normalizeLoginCallback(params.callbackURL);
  const accountDisabled = Array.isArray(params.error)
    ? params.error.includes('account_disabled')
    : params.error === 'account_disabled';

  return (
    <AuthPage>
      <div className="w-full">
        {accountDisabled ? (
          <div
            className="mb-5 rounded-lg border border-destructive/40 bg-destructive/5 p-3 shadow-none"
            role="alert"
          >
            <p className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-destructive">
              Account status
            </p>
            <p className="mt-1 text-sm leading-relaxed text-destructive">
              This account is suspended or revoked. Contact the workspace owner.
            </p>
          </div>
        ) : null}
        <LoginForm callbackURL={callbackURL} />
      </div>
    </AuthPage>
  );
}
