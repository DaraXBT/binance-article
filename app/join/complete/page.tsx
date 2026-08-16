import { EnrollmentCompletion } from '@/components/auth/enrollment-completion';
import {
  ConsoleHeader,
  SecureConsoleFrame,
} from '@/components/console/secure-console-frame';
import { ThemeToggle } from '@/components/theme-toggle';
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
    <SecureConsoleFrame
      variant="checkpoint"
      header={<ConsoleHeader actions={<ThemeToggle />} />}
      panel={false}
      contentClassName="flex items-center justify-center py-3 sm:py-5"
      footer={(
        <>
          <span className="font-mono uppercase tracking-[0.12em]">Enrollment checkpoint</span>
          <span>Private beta access</span>
        </>
      )}
    >
      <div className="mx-auto w-full max-w-md">
        <EnrollmentCompletion providerError={providerError} returnTo={returnTo} />
      </div>
    </SecureConsoleFrame>
  );
}
