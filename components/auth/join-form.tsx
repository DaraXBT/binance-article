'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { authClient } from '@/lib/auth-client';

type JoinState =
  | { status: 'invalid'; message: string }
  | { status: 'checking' }
  | { status: 'ready'; email: string }
  | { status: 'signing-in'; email: string }
  | { status: 'error'; message: string };

export function JoinForm({ token }: { token: string | null }) {
  const [state, setState] = useState<JoinState>(() => token
    ? { status: 'checking' }
    : { status: 'invalid', message: 'This invitation link is invalid or missing.' });

  useEffect(() => {
    if (!token) {
      setState({ status: 'invalid', message: 'This invitation link is invalid or missing.' });
      return;
    }

    const controller = new AbortController();
    setState({ status: 'checking' });
    void fetch('/api/invitations/accept', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json() as { email?: unknown; error?: unknown };
      if (!response.ok || typeof body.email !== 'string') {
        throw new Error(typeof body.error === 'string' ? body.error : 'The invitation is invalid or expired.');
      }
      setState({ status: 'ready', email: body.email });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'The invitation is invalid or expired.',
      });
    });

    return () => controller.abort();
  }, [token]);

  const startGoogleEnrollment = async () => {
    if (state.status !== 'ready') return;
    const email = state.email;
    setState({ status: 'signing-in', email });
    const result = await authClient.signIn.social({
      provider: 'google',
      callbackURL: '/workspace',
      newUserCallbackURL: '/workspace',
      requestSignUp: true,
    });
    if (result.error) {
      setState({ status: 'error', message: 'Google enrollment could not be started.' });
    }
  };

  const message = state.status === 'checking'
    ? 'Checking invitation…'
    : state.status === 'ready' || state.status === 'signing-in'
      ? `This invitation is for ${state.email}.`
      : state.message;

  return (
    <Card className="w-full max-w-md border-border/70 shadow-xl">
      <CardHeader>
        <CardTitle>Join the private beta</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          className="w-full"
          disabled={state.status !== 'ready'}
          onClick={startGoogleEnrollment}
          type="button"
        >
          {state.status === 'signing-in' ? 'Opening Google…' : 'Continue with Google'}
        </Button>
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        Already enrolled? <Link className="ml-1 underline" href="/login">Sign in</Link>
      </CardFooter>
    </Card>
  );
}
