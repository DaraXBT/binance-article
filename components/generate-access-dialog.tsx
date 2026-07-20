'use client';

import { useState, type FormEvent } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { FrameCornerHandles } from '@/components/console/secure-console-frame';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface GenerateAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void | Promise<void>;
}

export function GenerateAccessDialog({ open, onOpenChange, onSuccess }: GenerateAccessDialogProps) {
  const { messages } = useLanguage();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/generate-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error || messages.generateAccess.invalidCode);
        return;
      }

      setCode('');
      setError(null);
      // Notify the caller before closing. Consumers may use the close event
      // to decide whether a queued action should be replayed.
      await onSuccess();
      onOpenChange(false);
    } catch {
      setError(messages.generateAccess.invalidCode);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="console-dialog border-dotted p-4 sm:max-w-md sm:p-5">
        <FrameCornerHandles className="size-2.5 bg-card" />
        <DialogHeader className="border-b border-dotted border-border/70 pb-3 pr-6">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <span className="inline-flex size-7 shrink-0 items-center justify-center border border-primary/45 bg-primary/10 text-primary">
              <Lock className="size-3.5" />
            </span>
            {messages.generateAccess.title}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed sm:text-sm">
            {messages.generateAccess.description}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label
              htmlFor="generate-access-code"
              className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground"
            >
              {messages.generateAccess.codeLabel}
            </Label>
            <Input
              id="generate-access-code"
              type="password"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                if (error) setError(null);
              }}
              placeholder={messages.generateAccess.codePlaceholder}
              disabled={isSubmitting}
              autoComplete="off"
              autoFocus
              className="h-11 rounded-none border-dotted bg-background/40 font-mono tracking-[0.12em]"
            />
          </div>
          {error ? (
            <p
              className="border border-dotted border-destructive/45 bg-destructive/5 px-2.5 py-2 text-sm text-destructive"
              role="alert"
              aria-live="polite"
            >
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            size="sm"
            disabled={isSubmitting || !code.trim()}
            className="h-10 w-full rounded-none"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {messages.generateAccess.submitting}
              </>
            ) : (
              messages.generateAccess.submit
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
