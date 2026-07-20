'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { LanguageToggle } from '@/components/language-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  ConsoleHeader,
  ConsolePanel,
  SecureConsoleFrame,
} from '@/components/console/secure-console-frame';
import { Button } from '@/components/ui/button';
import { useCreateWorkspace } from '@/lib/hooks';
import { RecoverWorkspaceDialog } from './recover-workspace-dialog';

export function WorkspaceOnboarding({ notice }: { notice?: string | null } = {}) {
  const { messages } = useLanguage();
  const createWorkspace = useCreateWorkspace();
  const [recoverOpen, setRecoverOpen] = useState(false);

  return (
    <SecureConsoleFrame
      variant="private"
      eyebrow="WORKSPACE SETUP"
      title={messages.workspace.onboardingTitle}
      subtitle={messages.workspace.onboardingDescription}
      header={(
        <ConsoleHeader
          actions={(
            <>
              <LanguageToggle />
              <ThemeToggle />
            </>
          )}
        />
      )}
      statuses={[
        { label: 'Draft', value: 'HELD' },
        { label: 'Identity', value: 'VERIFIED', tone: 'success' },
        { label: 'Workspace', value: 'PENDING', tone: 'warning' },
        { label: 'AI access', value: 'LOCKED', tone: 'warning' },
      ]}
      panel={false}
      footer={(
        <>
          <span className="font-mono uppercase tracking-[0.1em]">Workspace checkpoint</span>
          <span className="hidden sm:inline">Choose a destination for this browser</span>
        </>
      )}
    >
      {notice ? (
        <p role="status" className="border border-dotted border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <ConsolePanel className="flex flex-col gap-4">
          <div className="space-y-2">
            <h2 className="text-base font-semibold">{messages.workspace.createWorkspaceTitle}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {messages.workspace.createWorkspaceDescription}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => createWorkspace.mutate()}
            disabled={createWorkspace.isPending}
            className="mt-auto h-10 w-full rounded-none"
          >
            {createWorkspace.isPending
              ? messages.workspace.createWorkspaceLoading
              : messages.workspace.createWorkspaceAction}
          </Button>
        </ConsolePanel>

        <ConsolePanel className="flex flex-col gap-4">
          <div className="space-y-2">
            <h2 className="text-base font-semibold">{messages.workspace.recoverWorkspaceTitle}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {messages.workspace.recoverWorkspaceDescription}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setRecoverOpen(true)} className="mt-auto h-10 w-full rounded-none border-dotted">
            {messages.workspace.openRecoverDialogAction}
          </Button>
        </ConsolePanel>
      </div>
      <RecoverWorkspaceDialog open={recoverOpen} onOpenChange={setRecoverOpen} />
    </SecureConsoleFrame>
  );
}
