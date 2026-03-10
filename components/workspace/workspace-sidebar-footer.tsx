'use client';

import { useState } from 'react';
import { Check, Copy, KeyRound, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { RecoverWorkspaceDialog } from './recover-workspace-dialog';

interface WorkspaceSidebarFooterProps {
  accessKeyPrefix: string;
  recoveryKey: string | null;
}

export function WorkspaceSidebarFooter({
  accessKeyPrefix,
  recoveryKey,
}: WorkspaceSidebarFooterProps) {
  const { messages } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [recoverOpen, setRecoverOpen] = useState(false);

  const handleCopy = () => {
    const textToCopy = recoveryKey || accessKeyPrefix;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div className="flex items-center gap-2 px-2">
        <KeyRound className="h-4 w-4 shrink-0 text-sidebar-foreground/60" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs text-sidebar-foreground">
            {accessKeyPrefix}...
          </p>
          <p className="truncate text-[10px] text-sidebar-foreground/60">
            {messages.workspace.sidebarKeyLabel}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleCopy}
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
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setRecoverOpen(true)}
          aria-label={messages.workspace.recoverDialogTitle}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <RecoverWorkspaceDialog
        open={recoverOpen}
        onOpenChange={setRecoverOpen}
      />
    </>
  );
}
