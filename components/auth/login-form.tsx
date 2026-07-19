'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authClient } from '@/lib/auth-client';

type LoginState = 'idle' | 'google' | 'telegram' | 'error';

export function LoginForm({ callbackURL = '/' }: { callbackURL?: string }) {
  const [state, setState] = useState<LoginState>('idle');

  const startGoogle = async () => {
    setState('google');
    const result = await authClient.signIn.social({ provider: 'google', callbackURL });
    if (result.error) setState('error');
  };

  const startTelegram = async () => {
    setState('telegram');
    const result = await authClient.signIn.oauth2({
      providerId: 'telegram',
      callbackURL,
      requestSignUp: false,
    });
    if (result.error) setState('error');
  };

  return (
    <Card className="w-full max-w-md border-border/70 shadow-xl">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Use Google, or a Telegram identity already linked to your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button className="w-full" disabled={state !== 'idle'} onClick={startGoogle} type="button">
          {state === 'google' ? 'Opening Google…' : 'Continue with Google'}
        </Button>
        <Button
          className="w-full"
          disabled={state !== 'idle'}
          onClick={startTelegram}
          type="button"
          variant="outline"
        >
          {state === 'telegram' ? 'Opening Telegram…' : 'Continue with Telegram'}
        </Button>
        {state === 'error' ? (
          <p className="text-sm text-destructive" role="alert">Sign-in could not be started. Please try again.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
