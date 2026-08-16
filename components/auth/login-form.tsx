'use client';

import { useState } from 'react';
import Link from 'next/link';

import { GoogleIcon } from '@/components/icons/google-icon';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { normalizeLoginCallback } from '@/lib/auth-return-to';
import { cn } from '@/lib/utils';

type LoginState = 'idle' | 'google' | 'error';

export function LoginForm({
  callbackURL = '/workspace',
  className,
  headingLevel = 1,
}: {
  callbackURL?: string;
  className?: string;
  /** Use a secondary heading when the page frame owns the primary title. */
  headingLevel?: 1 | 2;
}) {
  const { messages } = useLanguage();
  const copy = messages.auth;
  const [state, setState] = useState<LoginState>('idle');
  const returnTo = normalizeLoginCallback(callbackURL);
  const encodedReturnTo = encodeURIComponent(returnTo);

  const startGoogle = async () => {
    setState('google');
    try {
      const result = await authClient.signIn.social({
        provider: 'google',
        callbackURL: returnTo,
        errorCallbackURL: `/auth/error?flow=sign-in&returnTo=${encodedReturnTo}`,
      });
      if (result.error) setState('error');
    } catch {
      setState('error');
    }
  };

  const isBusy = state === 'google';
  const Heading = headingLevel === 2 ? 'h2' : 'h1';

  return (
    <section
      aria-labelledby="login-form-title"
      data-auth-panel="login"
      data-auth-state={state}
      aria-busy={isBusy}
      className={cn(
        'relative w-full max-w-md border-0 bg-transparent p-0 shadow-none',
        className,
      )}
    >
      <div className="mb-6">
        <Heading id="login-form-title" className="text-2xl font-semibold leading-tight tracking-normal sm:text-3xl">
          {copy.signInTitle}
        </Heading>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {copy.signInGoogleDescription}
        </p>
      </div>

      <div className="space-y-2.5">
        <Button
          className="h-11 w-full rounded-lg font-medium"
          disabled={isBusy}
          onClick={startGoogle}
          type="button"
        >
          <GoogleIcon
            aria-hidden="true"
            data-provider-icon="google"
            className="size-4"
          />
          {state === 'google' ? copy.openingGoogle : copy.continueGoogle}
        </Button>
        {state === 'error' ? (
          <p className="pt-1 text-sm text-destructive" role="alert" aria-live="polite">
            {copy.signInError}
          </p>
        ) : null}
      </div>

      <div className="mt-4 border-t border-border/60 pt-4 text-center text-sm text-muted-foreground">
        <Link
          className="underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:ring-offset-2"
          href={`/join?returnTo=${encodedReturnTo}`}
        >
          {copy.joinCodeTitle ?? copy.returnToJoin}
        </Link>
      </div>
    </section>
  );
}
