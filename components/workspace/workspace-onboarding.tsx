'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { useCreateWorkspace } from '@/lib/hooks';
import { RecoverWorkspaceDialog } from './recover-workspace-dialog';

export function WorkspaceOnboarding() {
  const { messages } = useLanguage();
  const createWorkspace = useCreateWorkspace();
  const [recoverOpen, setRecoverOpen] = useState(false);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-3xl space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">{messages.workspace.onboardingTitle}</h1>
          <p className="text-sm text-muted-foreground">{messages.workspace.onboardingDescription}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="space-y-4 border border-border/70 bg-background p-6">
            <div className="space-y-2">
              <h2 className="text-lg font-medium">{messages.workspace.createWorkspaceTitle}</h2>
              <p className="text-sm text-muted-foreground">
                {messages.workspace.createWorkspaceDescription}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => createWorkspace.mutate()}
              disabled={createWorkspace.isPending}
              className="w-full"
            >
              {createWorkspace.isPending
                ? messages.workspace.createWorkspaceLoading
                : messages.workspace.createWorkspaceAction}
            </Button>
          </section>

          <section className="space-y-4 border border-border/70 bg-background p-6">
            <div className="space-y-2">
              <h2 className="text-lg font-medium">{messages.workspace.recoverWorkspaceTitle}</h2>
              <p className="text-sm text-muted-foreground">
                {messages.workspace.recoverWorkspaceDescription}
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => setRecoverOpen(true)} className="w-full">
              {messages.workspace.openRecoverDialogAction}
            </Button>
          </section>
        </div>
      </div>

      <RecoverWorkspaceDialog open={recoverOpen} onOpenChange={setRecoverOpen} />
    </main>
  );
}
