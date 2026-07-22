'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { FrameCornerHandles } from '@/components/console/secure-console-frame';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface RecoveryKeyDialogProps {
  recoveryKey: string | null;
}

export function RecoveryKeyDialog({ recoveryKey }: RecoveryKeyDialogProps) {
  const { messages } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const open = !!recoveryKey && !acknowledged;

  const handleCopy = async () => {
    if (!recoveryKey) return;
    try {
      if (!navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permissions can be denied; keep the acknowledgement locked.
      setCopied(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="console-dialog border-dotted p-4 sm:max-w-lg sm:p-5"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <FrameCornerHandles />
        <DialogHeader className="border-b border-dotted border-border/70 pb-3 pr-6">
          <DialogTitle className="text-base sm:text-lg">{messages.workspace.recoveryDialogTitle}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed sm:text-sm">
            {messages.workspace.recoveryDialogDescription}
          </DialogDescription>
        </DialogHeader>

        <div
          className="console-data-card my-1 min-h-20 break-all bg-primary/[0.035] px-3.5 py-3 font-mono text-sm text-primary/90 dark:bg-primary/[0.025]"
          aria-live="polite"
        >
          {recoveryKey}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            type="button"
            variant="outline"
            onClick={handleCopy}
            className="h-10 w-full gap-2 rounded-lg"
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied
              ? messages.workspace.recoveryDialogCopied
              : messages.workspace.recoveryDialogCopy}
          </Button>

          {!copied && (
            <p className="border-l-2 border-primary/40 px-2 text-left text-xs leading-relaxed text-muted-foreground">
              {messages.workspace.recoveryDialogWarning}
            </p>
          )}

          <Button
            type="button"
            disabled={!copied}
            onClick={() => setAcknowledged(true)}
            className="h-10 w-full rounded-lg"
          >
            {messages.workspace.recoveryDialogAcknowledge}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
