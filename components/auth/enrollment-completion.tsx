'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { AuthErrorPanel } from '@/components/auth/auth-error-panel';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';

type CompletionState =
  | { status: 'completing' }
  | { status: 'complete' }
  | { status: 'error'; message: string; code: string | null };

function internalDestination(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/workspace';
  }
  try {
    const parsed = new URL(value, 'https://app.invalid');
    return parsed.origin === 'https://app.invalid'
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : '/workspace';
  } catch {
    return '/workspace';
  }
}

export function EnrollmentCompletion({ providerError }: { providerError?: string | null }) {
  const router = useRouter();
  const { messages } = useLanguage();
  const copy = messages.auth;
  const [state, setState] = useState<CompletionState>({ status: 'completing' });
  const [attempt, setAttempt] = useState(0);
  const startedAttemptRef = useRef<number | null>(null);

  const complete = useCallback(async () => {
    setState({ status: 'completing' });
    try {
      const response = await fetch('/api/enrollment/complete', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const body = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok) {
        const code = typeof body?.code === 'string' ? body.code : null;
        setState({
          status: 'error',
          message: copy.enrollmentCompleteFailed,
          code,
        });
        return;
      }

      setState({ status: 'complete' });
      router.replace(internalDestination(body?.redirectTo));
    } catch {
      setState({
        status: 'error',
        message: copy.enrollmentCompleteFailed,
        code: null,
      });
    }
  }, [copy.enrollmentCompleteFailed, router]);

  useEffect(() => {
    if (providerError || startedAttemptRef.current === attempt) return;
    startedAttemptRef.current = attempt;
    // The endpoint is idempotent. Keeping this request alive across React's
    // StrictMode effect replay avoids an abort/retry gap after OAuth.
    void complete();
  }, [attempt, complete, providerError]);

  if (providerError) {
    return <AuthErrorPanel error={providerError} context="join" />;
  }

  return (
    <section
      aria-labelledby="enrollment-completion-title"
      data-enrollment-completion={state.status}
      aria-busy={state.status === 'completing'}
      className="studio-auth-panel relative w-full max-w-md rounded-xl border border-dotted border-border bg-card/80 p-5 shadow-none dark:border-border/70 dark:bg-card/60 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-dotted border-border text-primary">
          {state.status === 'complete' ? (
            <CheckCircle2 aria-hidden="true" className="size-4" />
          ) : (
            <Loader2
              aria-hidden="true"
              className={state.status === 'completing' ? 'size-4 animate-spin' : 'size-4 text-destructive'}
            />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h1 id="enrollment-completion-title" className="text-xl font-semibold leading-tight sm:text-2xl">
            {state.status === 'complete' ? 'Welcome to xArticle' : 'Finishing enrollment'}
          </h1>
          <p
            role={state.status === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={state.status === 'error'
              ? 'mt-1.5 text-sm leading-relaxed text-destructive'
              : 'mt-1.5 text-sm leading-relaxed text-muted-foreground'}
          >
            {state.status === 'complete'
              ? copy.enrollmentComplete
              : state.status === 'error'
                ? state.message
                : 'Confirming your account and personal workspace…'}
          </p>
        </div>
      </div>

      {state.status === 'error' ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-4">
          <Button
            type="button"
            size="sm"
            className="h-10 rounded-lg"
            onClick={() => {
              startedAttemptRef.current = null;
              setAttempt((value) => value + 1);
            }}
          >
            {copy.continueEnrollment}
          </Button>
          <Button asChild type="button" size="sm" variant="outline" className="h-10 rounded-lg">
            <Link href="/join">{copy.returnToJoin}</Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export { internalDestination };
