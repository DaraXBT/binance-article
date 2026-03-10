'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
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

  const handleCopy = () => {
    if (!recoveryKey) return;
    navigator.clipboard.writeText(recoveryKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{messages.workspace.recoveryDialogTitle}</DialogTitle>
          <DialogDescription>
            {messages.workspace.recoveryDialogDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="my-4 break-all rounded-md border border-border/70 bg-muted/30 p-4 font-mono text-sm">
          {recoveryKey}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            type="button"
            variant="outline"
            onClick={handleCopy}
            className="w-full gap-2"
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
            <p className="text-center text-xs text-muted-foreground">
              {messages.workspace.recoveryDialogWarning}
            </p>
          )}

          <Button
            type="button"
            disabled={!copied}
            onClick={() => setAcknowledged(true)}
            className="w-full"
          >
            {messages.workspace.recoveryDialogAcknowledge}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
