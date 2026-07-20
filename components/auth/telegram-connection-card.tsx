'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

type ConnectionState = 'idle' | 'linking' | 'error';

export function TelegramConnectionCard({
  enabled,
  className,
}: {
  enabled: boolean;
  className?: string;
}) {
  const [state, setState] = useState<ConnectionState>('idle');

  const connectTelegram = async () => {
    if (!enabled) return;
    setState('linking');
    try {
      const result = await authClient.oauth2.link({
        providerId: 'telegram',
        callbackURL: '/settings/connections',
      });
      if (result.error) setState('error');
    } catch {
      setState('error');
    }
  };

  return (
    <Card className={cn('w-full max-w-xl border-border/70 shadow-lg', className)}>
      <CardHeader>
        <CardTitle>Telegram connection</CardTitle>
        <CardDescription>
          {enabled
            ? 'Link Telegram to your existing Google-enrolled account. Telegram cannot create an account.'
            : 'Telegram OAuth is not configured for this deployment.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!enabled ? (
          <p className="text-sm text-muted-foreground">
            Telegram linking is unavailable. Ask the deployment owner to configure it if needed.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Telegram receives publishing metadata only. Your Binance login, cookies, Chrome profile,
              local drafts, and publisher device token stay on your paired computer.
            </p>
            <Button
              disabled={state === 'linking'}
              onClick={connectTelegram}
              type="button"
            >
              {state === 'linking' ? 'Opening Telegram…' : 'Connect Telegram'}
            </Button>
            {state === 'error' ? (
              <p className="text-sm text-destructive" role="alert">
                Telegram could not be connected. Please try again.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
