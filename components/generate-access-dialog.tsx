'use client';

import { useState, type FormEvent } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
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
  onSuccess: () => void;
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
      onOpenChange(false);
      onSuccess();
    } catch {
      setError(messages.generateAccess.invalidCode);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {messages.generateAccess.title}
          </DialogTitle>
          <DialogDescription>
            {messages.generateAccess.description}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="generate-access-code">{messages.generateAccess.codeLabel}</Label>
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
              autoFocus
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={isSubmitting || !code.trim()} className="w-full">
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
