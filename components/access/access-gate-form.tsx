'use client';

import { useState, type FormEvent } from 'react';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function AccessGateForm() {
  const { messages } = useLanguage();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const response = await fetch('/api/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      setError(data?.error || messages.accessGate.invalidCode);
      setIsSubmitting(false);
      return;
    }

    window.location.href = '/workspace';
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="app-access-code">{messages.accessGate.title}</Label>
        <Input
          id="app-access-code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            if (error) {
              setError(null);
            }
          }}
          placeholder={messages.accessGate.codePlaceholder}
          disabled={isSubmitting}
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={isSubmitting || !code.trim()} className="w-full">
        {isSubmitting ? messages.accessGate.submitting : messages.accessGate.submit}
      </Button>
    </form>
  );
}
