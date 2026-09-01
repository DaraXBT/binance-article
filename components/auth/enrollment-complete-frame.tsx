'use client';

import type { ReactNode } from 'react';

import {
  ConsoleHeader,
  SecureConsoleFrame,
} from '@/components/console/secure-console-frame';
import { useLanguage } from '@/components/language-provider';
import { ThemeToggle } from '@/components/theme-toggle';

export function EnrollmentCompleteFrame({
  children,
}: {
  children: ReactNode;
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
        {children}
      </div>
    </SecureConsoleFrame>
  );
}
