'use client';

import { useState } from 'react';

import { FrameCornerHandles } from '@/components/console/secure-console-frame';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

type LoginState = 'idle' | 'google' | 'telegram' | 'error';

export function LoginForm({
  callbackURL = '/workspace',
  telegramEnabled,
  className,
  headingLevel = 1,
}: {
  callbackURL?: string;
  telegramEnabled: boolean;
  className?: string;
  /** Use a secondary heading when the page frame owns the primary title. */
  headingLevel?: 1 | 2;
}) {
  const { messages } = useLanguage();
  const copy = messages.auth;
  const [state, setState] = useState<LoginState>('idle');

  const startGoogle = async () => {
    setState('google');
    try {
      const result = await authClient.signIn.social({ provider: 'google', callbackURL });
      if (result.error) setState('error');
    } catch {
      setState('error');
    }
  };

  const startTelegram = async () => {
    if (!telegramEnabled) return;
    setState('telegram');
    try {
      const result = await authClient.signIn.oauth2({
        providerId: 'telegram',
        callbackURL,
        requestSignUp: false,
      });
      if (result.error) setState('error');
    } catch {
      setState('error');
    }
  };

  const isBusy = state === 'google' || state === 'telegram';
  const Heading = headingLevel === 2 ? 'h2' : 'h1';

  return (
    <section
      aria-labelledby="login-form-title"
      data-auth-panel="login"
      data-auth-state={state}
      aria-busy={isBusy}
      className={cn(
        'relative w-full max-w-md border border-dotted border-border bg-card/80 p-3.5 dark:border-border/70 dark:bg-card/60 sm:p-4',
        className,
      )}
    >
      <FrameCornerHandles className="size-2.5 bg-card" />
      <div className="mb-3.5 border-b border-border/70 pb-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-primary">
            OAUTH CHECKPOINT
          </span>
          <span className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-muted-foreground/70">
            RETURNING USER
          </span>
        </div>
        <Heading id="login-form-title" className="text-lg font-semibold leading-tight sm:text-xl">
          {copy.signInTitle}
        </Heading>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {telegramEnabled
            ? copy.signInTelegramDescription
            : copy.signInGoogleDescription}
        </p>
      </div>

      <div className="space-y-2.5">
        <Button
          className="h-11 w-full rounded-none font-medium"
          disabled={isBusy}
          onClick={startGoogle}
          type="button"
        >
          {state === 'google' ? copy.openingGoogle : copy.continueGoogle}
        </Button>
        {telegramEnabled ? (
          <Button
            className="h-11 w-full rounded-none font-medium"
            disabled={isBusy}
            onClick={startTelegram}
            type="button"
            variant="outline"
          >
            {state === 'telegram' ? copy.openingTelegram : copy.continueTelegram}
          </Button>
        ) : null}
        {state === 'error' ? (
          <p className="pt-1 text-sm text-destructive" role="alert" aria-live="polite">
            {copy.signInError}
          </p>
        ) : null}
      </div>

      <p className="mt-3 border-t border-border/60 pt-3 font-mono text-[0.625rem] uppercase tracking-[0.1em] text-muted-foreground/70">
        {copy.secureRedirect}
      </p>
    </section>
  );
}
