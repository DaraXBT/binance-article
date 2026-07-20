'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import {
  ConsoleStatusRail,
  FrameCornerHandles,
  type ConsoleStatusItem,
} from '@/components/console/secure-console-frame';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

type JoinState =
  | { status: 'invalid'; message: string }
  | { status: 'checking' }
  | { status: 'ready'; email: string }
  | { status: 'signing-in'; email: string }
  | { status: 'error'; message: string; retry: 'invitation' }
  | { status: 'error'; message: string; retry: 'provider'; email: string };

export function JoinForm({
  token,
  className,
  headingLevel = 1,
}: {
  token: string | null;
  className?: string;
  /** Use a secondary heading when the page frame owns the primary title. */
  headingLevel?: 1 | 2;
}) {
  const { messages } = useLanguage();
  const copy = messages.auth;
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [state, setState] = useState<JoinState>(() => token
    ? { status: 'checking' }
    : { status: 'invalid', message: copy.invitationMissing });

  useEffect(() => {
    if (!token) {
      setState({ status: 'invalid', message: copy.invitationMissing });
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
        setState({
          status: 'invalid',
          message: typeof body.error === 'string'
            ? body.error
            : copy.invitationExpired,
        });
        return;
      }
      setState({ status: 'ready', email: body.email });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : copy.invitationExpired,
        retry: 'invitation',
      });
    });

    return () => controller.abort();
  }, [copy.invitationExpired, copy.invitationMissing, token, validationAttempt]);

  const startGoogleEnrollment = async () => {
    const email = state.status === 'ready'
      ? state.email
      : state.status === 'error' && state.retry === 'provider'
        ? state.email
        : null;
    if (!email) return;

    setState({ status: 'signing-in', email });
    try {
      const result = await authClient.signIn.social({
        provider: 'google',
        callbackURL: '/workspace',
        newUserCallbackURL: '/workspace',
        requestSignUp: true,
      });
      if (result.error) {
        setState({
          status: 'error',
          message: copy.enrollmentError,
          retry: 'provider',
          email,
        });
      }
    } catch {
      setState({
        status: 'error',
        message: copy.enrollmentError,
        retry: 'provider',
        email,
      });
    }
  };

  const message = state.status === 'checking'
    ? copy.checkingInvitation
    : state.status === 'ready' || state.status === 'signing-in'
      ? copy.invitationFor(state.email)
      : state.message;
  const canStartGoogle = state.status === 'ready' || (
    state.status === 'error' && state.retry === 'provider'
  );
  const messageRole = state.status === 'checking'
    ? 'status'
    : state.status === 'invalid' || state.status === 'error'
      ? 'alert'
      : undefined;
  const Heading = headingLevel === 2 ? 'h2' : 'h1';
  const invitationStatus = state.status === 'checking'
    ? 'CHECKING'
    : state.status === 'invalid'
      ? 'INVALID'
      : state.status === 'error' && state.retry === 'invitation'
        ? 'UNAVAILABLE'
        : 'VERIFIED';
  const enrollmentStatus = state.status === 'signing-in'
    ? 'OPENING'
    : canStartGoogle
      ? 'READY'
      : 'LOCKED';
  const statusItems: ConsoleStatusItem[] = [
    {
      label: 'Invitation',
      value: invitationStatus,
      tone: invitationStatus === 'VERIFIED'
        ? 'success'
        : invitationStatus === 'CHECKING'
          ? 'action'
          : 'danger',
    },
    {
      label: 'Enrollment',
      value: enrollmentStatus,
      tone: enrollmentStatus === 'READY' ? 'success' : enrollmentStatus === 'OPENING' ? 'action' : 'neutral',
    },
    { label: 'Provider', value: 'GOOGLE', tone: 'neutral' },
    { label: 'Session', value: 'PRIVATE', tone: 'success' },
  ];

  return (
    <section
      aria-labelledby="join-form-title"
      data-auth-panel="join"
      data-auth-state={state.status}
      aria-busy={state.status === 'checking' || state.status === 'signing-in'}
      className={cn(
        'relative w-full max-w-md border border-dotted border-border bg-card/80 p-3.5 dark:border-border/70 dark:bg-card/60 sm:p-4',
        className,
      )}
    >
      <FrameCornerHandles className="size-2.5 bg-card" />
      <div className="mb-3.5 border-b border-border/70 pb-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-primary">
            INVITATION CHECKPOINT
          </span>
          <span className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-muted-foreground/70">
            PRIVATE BETA
          </span>
        </div>
        <Heading id="join-form-title" className="text-lg font-semibold leading-tight sm:text-xl">
          {copy.joinTitle}
        </Heading>
        <p role={messageRole} aria-live="polite" className={cn(
          'mt-1.5 text-sm leading-relaxed',
          state.status === 'invalid' || state.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
        )}>
          {message}
        </p>
      </div>

      <ConsoleStatusRail items={statusItems} className="mb-3.5" />

      <div className="space-y-2.5">
        <Button
          className="h-11 w-full rounded-none font-medium"
          disabled={!canStartGoogle}
          onClick={startGoogleEnrollment}
          type="button"
        >
          {state.status === 'signing-in' ? copy.openingGoogle : copy.continueGoogle}
        </Button>
        {state.status === 'error' && state.retry === 'invitation' ? (
          <Button
            className="h-11 w-full rounded-none font-medium"
            onClick={() => setValidationAttempt((attempt) => attempt + 1)}
            type="button"
            variant="outline"
          >
            {copy.checkInvitationAgain}
          </Button>
        ) : null}
      </div>

      <div className="mt-3 border-t border-border/60 pt-3 text-center text-sm text-muted-foreground">
        {copy.alreadyEnrolled}{' '}
        <Link
          className="ml-1 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:ring-offset-2"
          href="/login"
        >
          {copy.signInTitle}
        </Link>
      </div>
    </section>
  );
}
