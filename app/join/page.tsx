import { JoinForm } from '@/components/auth/join-form';
import { AuthPage } from '@/components/auth-page';
import { normalizeLoginCallback } from '@/server/auth/page-authorization';

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{
    token?: string | string[];
    returnTo?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : null;
  const returnTo = normalizeLoginCallback(params.returnTo);

  return (
    <AuthPage decorativeBackground={false}>
      <div className="w-full">
        <JoinForm
          token={token}
          returnTo={returnTo}
          checkExistingClaim
        />
      </div>
    </AuthPage>
  );
}
