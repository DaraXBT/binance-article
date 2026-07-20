'use client';

import { useState, type FormEvent } from 'react';
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
import { Input } from '@/components/ui/input';
import { useRecoverWorkspace } from '@/lib/hooks';

interface RecoverWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the key has been claimed successfully. */
  onSuccess?: () => void;
}

export function RecoverWorkspaceDialog({
  open,
  onOpenChange,
  onSuccess,
}: RecoverWorkspaceDialogProps) {
  const { messages } = useLanguage();
  const recoverWorkspace = useRecoverWorkspace();
  const [keyInput, setKeyInput] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!keyInput.trim()) {
      setMessage(messages.workspace.recoverDialogKeyRequired);
      setIsError(true);
      return;
    }

    setMessage(null);
    setIsError(false);

    try {
      await recoverWorkspace.mutateAsync(keyInput);
      setMessage(messages.workspace.recoverDialogSuccess);
      setIsError(false);
      setKeyInput('');
      onSuccess?.();
      setTimeout(() => onOpenChange(false), 1200);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : messages.workspace.recoverDialogFailed
      );
      setIsError(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="console-dialog max-h-[calc(100dvh-2rem)] overflow-y-auto border-dotted p-4 sm:p-5">
        <FrameCornerHandles className="size-2.5 bg-card" />
        <DialogHeader className="border-b border-dotted border-border/70 pb-3 pr-6">
          <DialogTitle className="text-base sm:text-lg">{messages.workspace.recoverDialogTitle}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed sm:text-sm">
            {messages.workspace.recoverDialogDescription}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            value={keyInput}
            onChange={(event) => {
              setKeyInput(event.target.value);
              if (message) {
                setMessage(null);
                setIsError(false);
              }
            }}
            placeholder={messages.workspace.recoverDialogPlaceholder}
            disabled={recoverWorkspace.isPending}
            autoComplete="off"
            className="h-11 rounded-none border-dotted bg-background/40 font-mono text-sm tracking-wide"
          />

          {message && (
            <p
              className={`border border-dotted px-2.5 py-2 text-sm ${isError ? 'border-destructive/45 bg-destructive/5 text-destructive' : 'border-emerald-600/35 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'}`}
              role={isError ? 'alert' : 'status'}
              aria-live="polite"
            >
              {message}
            </p>
          )}

          <DialogFooter className="pt-1">
            <Button type="submit" disabled={recoverWorkspace.isPending} className="h-10 w-full rounded-none sm:w-auto">
              {recoverWorkspace.isPending
                ? messages.workspace.recoverDialogRecovering
                : messages.workspace.recoverDialogAction}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
