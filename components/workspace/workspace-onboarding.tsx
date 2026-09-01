'use client';

import { useLanguage } from '@/components/language-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  ConsoleHeader,
  ConsolePanel,
  SecureConsoleFrame,
} from '@/components/console/secure-console-frame';

export function WorkspaceOnboarding({ notice }: { notice?: string | null } = {}) {
  const { messages } = useLanguage();

  return (
    <SecureConsoleFrame
      variant="private"
      surface="checkpoint"
      eyebrow={messages.workspace.onboardingTitle}
      title={messages.workspace.onboardingTitle}
      header={(
        <ConsoleHeader
          brandHref="/workspace"
          actions={(
            <>
              <ThemeToggle />
            </>
          )}
        />
      )}
      panel={false}
      footer={(
        <>
          <span className="font-mono uppercase tracking-[0.1em]">{messages.auth.accountStatus}</span>
          <span className="hidden sm:inline">{messages.workspace.bootstrapLoadingDescription}</span>
        </>
      )}
    >
      {notice ? (
        <p role="status" className="border border-dotted border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      <ConsolePanel className="rounded-xl">
        <p className="text-sm leading-relaxed text-muted-foreground" role="status">
          {messages.workspace.onboardingDescription}
        </p>
      </ConsolePanel>
    </SecureConsoleFrame>
  );
}
