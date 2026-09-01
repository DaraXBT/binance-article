import { EnrollmentCompleteFrame } from '@/components/auth/enrollment-complete-frame';
import { EnrollmentCompletion } from '@/components/auth/enrollment-completion';
import { normalizeLoginCallback } from '@/server/auth/page-authorization';

export default async function EnrollmentCompletePage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[];
    returnTo?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const providerError = Array.isArray(params.error) ? params.error[0] : params.error;
  const returnTo = normalizeLoginCallback(params.returnTo);

  return (
    <EnrollmentCompleteFrame>
      <EnrollmentCompletion providerError={providerError} returnTo={returnTo} />
    </EnrollmentCompleteFrame>
  );
}
