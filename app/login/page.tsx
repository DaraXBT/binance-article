import { LoginForm } from '@/components/auth/login-form';
import { parseTelegramAuthEnvironment } from '@/server/auth/auth-policy';
import { normalizeLoginCallback } from '@/server/auth/page-authorization';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackURL?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const callbackURL = normalizeLoginCallback(params.callbackURL);
  const accountDisabled = params.error === 'account_disabled';
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md space-y-4">
        {accountDisabled ? (
          <p className="text-sm text-destructive" role="alert">
            This account is suspended or revoked. Contact the workspace owner.
          </p>
        ) : null}
        <LoginForm
          callbackURL={callbackURL}
          telegramEnabled={parseTelegramAuthEnvironment(process.env) !== null}
        />
      </div>
    </main>
  );
}
