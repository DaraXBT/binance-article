'use client';

import { useState, type FormEvent } from 'react';
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{messages.workspace.recoverDialogTitle}</DialogTitle>
          <DialogDescription>
            {messages.workspace.recoverDialogDescription}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
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
          />

          {message && (
            <p
              className={`text-sm ${isError ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {message}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={recoverWorkspace.isPending}>
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
