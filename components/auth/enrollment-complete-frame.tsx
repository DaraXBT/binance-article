'use client';

import { EnrollmentCompletion } from '@/components/auth/enrollment-completion';
import {
  ConsoleHeader,
  SecureConsoleFrame,
} from '@/components/console/secure-console-frame';
import { useLanguage } from '@/components/language-provider';
import { ThemeToggle } from '@/components/theme-toggle';

export function EnrollmentCompleteFrame({
  providerError,
  returnTo,
}: {
  providerError?: string | null;
  returnTo?: string | null;
}) {
  const { messages } = useLanguage();

  return (
    <SecureConsoleFrame
      variant="checkpoint"
      header={<ConsoleHeader actions={<ThemeToggle />} />}
      panel={false}
      contentClassName="flex items-center justify-center py-3 sm:py-5"
      footer={(
        <>
          <span className="font-mono uppercase tracking-[0.12em]">{messages.auth.enrollmentCheckpoint}</span>
          <span>{messages.auth.privateBetaAccess}</span>
        </>
      )}
    >
      <div className="mx-auto w-full max-w-md">
        <EnrollmentCompletion providerError={providerError} returnTo={returnTo} />
      </div>
    </SecureConsoleFrame>
  );
}
