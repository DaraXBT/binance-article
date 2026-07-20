'use client';

import { useState } from 'react';
import { Check, Copy, KeyRound, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { ConsolePanel } from '@/components/console/secure-console-frame';
import { Button } from '@/components/ui/button';
import { RecoverWorkspaceDialog } from './recover-workspace-dialog';

interface WorkspaceSidebarFooterProps {
  accessKeyPrefix: string;
  recoveryKey: string | null;
  showRecovery?: boolean;
}

export function WorkspaceSidebarFooter({
  accessKeyPrefix,
  recoveryKey,
  showRecovery = true,
}: WorkspaceSidebarFooterProps) {
  const { messages } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [recoverOpen, setRecoverOpen] = useState(false);

  const handleCopy = async () => {
    const textToCopy = recoveryKey || accessKeyPrefix;
    try {
      if (!navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <ConsolePanel
        corners={false}
        className="mx-1 border-dotted border-sidebar-border/80 bg-sidebar/60 p-2"
      >
        <div className="flex min-w-0 items-center gap-2">
        <KeyRound className="size-3.5 shrink-0 text-sidebar-foreground/60" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[0.68rem] font-semibold tracking-wide text-sidebar-foreground">
            {accessKeyPrefix}...
          </p>
          <p className="truncate font-mono text-[0.58rem] uppercase tracking-[0.12em] text-sidebar-foreground/60">
            {messages.workspace.sidebarKeyLabel}
          </p>
        </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={handleCopy}
            className="size-7 rounded-none"
          aria-label={
            recoveryKey
              ? messages.workspace.copyFullKey
              : messages.workspace.copyPrefix
          }
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
        {showRecovery ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setRecoverOpen(true)}
            className="size-7 rounded-none"
            aria-label={messages.workspace.recoverDialogTitle}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
      </ConsolePanel>

      {showRecovery ? (
        <RecoverWorkspaceDialog
          open={recoverOpen}
          onOpenChange={setRecoverOpen}
        />
      ) : null}
    </>
  );
}
