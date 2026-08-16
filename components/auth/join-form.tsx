'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { GoogleIcon } from '@/components/icons/google-icon';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';
import { normalizeLoginCallback } from '@/lib/auth-return-to';
import { cn } from '@/lib/utils';

type EnrollmentSource = 'shared' | 'legacy';

type JoinState =
  | { status: 'code-entry' }
  | { status: 'checking'; source: EnrollmentSource }
  | { status: 'ready'; source: EnrollmentSource; email?: string }
  | { status: 'signing-in'; source: EnrollmentSource; email?: string }
  | { status: 'invalid'; message: string }
  | { status: 'error'; message: string; retry: 'code' | 'provider'; source?: EnrollmentSource; email?: string };

type JoinErrorCode =
  | 'ENROLLMENT_CODE_INVALID'
  | 'ENROLLMENT_CODE_EXPIRED'
  | 'ENROLLMENT_CODE_REVOKED'
  | 'ENROLLMENT_CODE_ROTATED'
  | 'ENROLLMENT_CAPACITY_FULL'
  | 'ENROLLMENT_RATE_LIMITED'
  | 'INVITATION_ACCEPT_FAILED'
  | 'INVALID_INVITATION'
  | string;

class JoinApiError extends Error {
  constructor(
    message: string,
    readonly code: JoinErrorCode | null = null,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'JoinApiError';
  }
}

function createIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Hardened browsers may deny access to the crypto facade. The fallback is
    // only an idempotency key; the bearer code itself never uses this value.
  }
  return `join-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function normalizeCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, '')
    .replace(/_/g, '-');
}

function readHashCode(): string | null {
  if (typeof window === 'undefined') return null;
  const rawHash = window.location.hash.replace(/^#/, '');
  if (!rawHash) return null;

  const params = new URLSearchParams(rawHash);
  const candidate = params.get('code') ?? (rawHash.includes('=') ? null : rawHash);
  return candidate ? normalizeCode(candidate) : null;
}

function scrubHash(): void {
  if (typeof window === 'undefined' || !window.location.hash) return;
  try {
    window.history.replaceState(
      window.history.state,
      document.title,
      `${window.location.pathname}${window.location.search}`,
    );
  } catch {
    // URL scrubbing is best effort; the fragment is never sent in HTTP
    // requests, and the claim cookie is still protected by HttpOnly.
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null);
  return payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {};
}

function errorCodeFromBody(body: Record<string, unknown>): JoinErrorCode | null {
  return typeof body.code === 'string'
    ? body.code
    : typeof body.errorCode === 'string'
      ? body.errorCode
      : null;
}

function mapJoinError(
  code: JoinErrorCode | null,
  status: number,
  copy: typeof import('@/lib/i18n').translations.en.auth,
  legacy = false,
): string {
  if (legacy) return copy.invitationExpired;
  switch (code) {
    case 'ENROLLMENT_CODE_EXPIRED':
      return copy.codeExpired;
    case 'ENROLLMENT_CODE_ROTATED':
    case 'ENROLLMENT_CODE_REVOKED':
      return copy.codeRotated;
    case 'ENROLLMENT_CAPACITY_FULL':
    case 'BETA_USER_CAP_REACHED':
      return copy.codeCapacityFull;
    case 'ENROLLMENT_RATE_LIMITED':
    case 'RATE_LIMITED':
      return copy.codeRateLimited;
    case 'ENROLLMENT_CODE_INVALID':
    case 'INVALID_ENROLLMENT_CODE':
      return copy.codeInvalid;
    default:
      return status === 429 ? copy.codeRateLimited : copy.codeCheckFailed;
  }
}

async function claimSharedCode(
  code: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetch('/api/enrollment/claim', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ code, idempotencyKey }),
    signal,
  });
  const body = await readJson(response);
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'The enrollment code could not be checked.';
    throw new JoinApiError(message, errorCodeFromBody(body), response.status);
  }
  return body;
}

export interface JoinFormProps {
  /** Existing email-bound invitation token. Kept for the temporary migration window. */
  token?: string | null;
  /** Optional prefilled code. Production share links carry this value in a fragment. */
  code?: string | null;
  /** Internal destination to open after enrollment finishes. */
  returnTo?: string | null;
  /** Check the server for a retryable HttpOnly claim before requesting the code again. */
  checkExistingClaim?: boolean;
  className?: string;
  /** Use a secondary heading when the page frame owns the primary title. */
  headingLevel?: 1 | 2;
}

export function JoinForm({
  token = null,
  code: initialCode = null,
  returnTo,
  checkExistingClaim = false,
  className,
  headingLevel = 1,
}: JoinFormProps) {
  const { messages } = useLanguage();
  const copy = messages.auth;
  const [code, setCode] = useState(() => normalizeCode(initialCode ?? ''));
  const [state, setState] = useState<JoinState>(() => token
    ? { status: 'checking', source: 'legacy' }
    : initialCode
      ? { status: 'checking', source: 'shared' }
      : checkExistingClaim
        ? { status: 'checking', source: 'shared' }
        : { status: 'code-entry' });
  const autoCredentialRef = useRef<string | null>(null);
  const idempotencyRef = useRef<{ code: string; key: string } | null>(null);

  const startGoogleEnrollment = useCallback(async () => {
    const source = state.status === 'ready'
      ? state.source
      : state.status === 'error' && state.retry === 'provider'
        ? state.source
        : undefined;
    if (!source) return;

    const email = state.status === 'ready' || state.status === 'signing-in' || (
      state.status === 'error' && state.retry === 'provider'
    ) ? state.email : undefined;
    setState({ status: 'signing-in', source, ...(email ? { email } : {}) });
    try {
      const encodedReturnTo = returnTo == null
        ? null
        : encodeURIComponent(normalizeLoginCallback(returnTo));
      const callbackURL = encodedReturnTo == null
        ? '/join/complete'
        : `/join/complete?returnTo=${encodedReturnTo}`;
      const result = await authClient.signIn.social({
        provider: 'google',
        callbackURL,
        newUserCallbackURL: callbackURL,
        requestSignUp: true,
        errorCallbackURL: encodedReturnTo == null
          ? '/auth/error?flow=enrollment'
          : `/auth/error?flow=enrollment&returnTo=${encodedReturnTo}`,
      });
      if (result.error) {
        setState({
          status: 'error',
          message: copy.enrollmentError,
          retry: 'provider',
          source,
          ...(email ? { email } : {}),
        });
      }
    } catch {
      setState({
        status: 'error',
        message: copy.enrollmentError,
        retry: 'provider',
        source,
        ...(email ? { email } : {}),
      });
    }
  }, [copy.enrollmentError, returnTo, state]);

  const validateLegacyInvitation = useCallback(async (legacyToken: string, signal?: AbortSignal) => {
    setState({ status: 'checking', source: 'legacy' });
    try {
      const response = await fetch('/api/invitations/accept', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: legacyToken }),
        signal,
      });
      const body = await readJson(response);
      if (!response.ok || typeof body.email !== 'string') {
        const codeValue = errorCodeFromBody(body);
        setState({
          status: 'invalid',
          message: typeof body.error === 'string'
            ? body.error
            : mapJoinError(codeValue, response.status, copy, true),
        });
        return;
      }
      setState({ status: 'ready', source: 'legacy', email: body.email });
    } catch (error: unknown) {
      if (signal?.aborted) return;
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : copy.invitationExpired,
        retry: 'code',
        source: 'legacy',
      });
    }
  }, [copy]);

  const validateSharedCode = useCallback(async (rawCode: string, signal?: AbortSignal) => {
    const normalized = normalizeCode(rawCode);
    if (!normalized) {
      setState({ status: 'invalid', message: copy.codeRequired });
      return;
    }
    const idempotencyKey = idempotencyRef.current?.code === normalized
      ? idempotencyRef.current.key
      : createIdempotencyKey();
    idempotencyRef.current = { code: normalized, key: idempotencyKey };
    setState({ status: 'checking', source: 'shared' });
    try {
      await claimSharedCode(normalized, idempotencyKey, signal);
      // The code is a bearer secret. Clear it from the form after the server
      // has exchanged it for an HttpOnly claim cookie.
      setCode('');
      setState({ status: 'ready', source: 'shared' });
    } catch (error: unknown) {
      if (signal?.aborted) return;
      const apiError = error instanceof JoinApiError ? error : null;
      setState({
        status: 'invalid',
        message: apiError
          ? mapJoinError(apiError.code, apiError.status, copy)
          : copy.codeCheckFailed,
      });
    }
  }, [copy]);

  const validateExistingClaim = useCallback(async (signal?: AbortSignal) => {
    setState({ status: 'checking', source: 'shared' });
    try {
      const response = await fetch('/api/enrollment/claim/status', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      });
      const body = await readJson(response);
      if (!response.ok || body.ready !== true) {
        setState({ status: 'code-entry' });
        return;
      }
      setState({ status: 'ready', source: 'shared' });
    } catch {
      if (signal?.aborted) return;
      // Readiness is an optimization for provider retries. Fail closed to the
      // normal code-entry flow without exposing server or claim details.
      setState({ status: 'code-entry' });
    }
  }, []);

  useEffect(() => {
    const fragmentCode = readHashCode();
    scrubHash();

    if (token) {
      const credentialKey = `legacy:${token}`;
      if (autoCredentialRef.current === credentialKey) return;
      autoCredentialRef.current = credentialKey;
      // Do not abort this one-time exchange during React StrictMode's
      // development-only effect replay; the ref deliberately prevents a
      // duplicate exchange on the second pass.
      void validateLegacyInvitation(token);
      return undefined;
    }

    const candidate = initialCode ? normalizeCode(initialCode) : fragmentCode;
    if (candidate) {
      const credentialKey = `shared:${candidate}`;
      if (autoCredentialRef.current === credentialKey) return;
      autoCredentialRef.current = credentialKey;
      setCode(candidate);
      void validateSharedCode(candidate);
      return undefined;
    }
    if (checkExistingClaim) {
      const credentialKey = 'existing-claim';
      if (autoCredentialRef.current === credentialKey) return;
      autoCredentialRef.current = credentialKey;
      void validateExistingClaim();
      return undefined;
    }
    autoCredentialRef.current = 'empty';
    return undefined;
  }, [
    checkExistingClaim,
    initialCode,
    token,
    validateExistingClaim,
    validateLegacyInvitation,
    validateSharedCode,
  ]);

  const email = state.status === 'ready' || state.status === 'signing-in' || (
    state.status === 'error' && state.retry === 'provider'
  ) ? state.email : undefined;
  const isChecking = state.status === 'checking';
  const isSigningIn = state.status === 'signing-in';
  const canStartGoogle = state.status === 'ready' || (
    state.status === 'error' && state.retry === 'provider'
  );
  const showCodeForm = !token && !canStartGoogle && state.status !== 'checking';
  const message = isChecking
    ? copy.checkingInvitation
    : state.status === 'ready' || state.status === 'signing-in'
      ? email
        ? copy.invitationFor(email)
        : copy.enrollmentReady
      : state.status === 'code-entry'
        ? copy.joinCodeDescription
        : state.message;
  const messageRole = isChecking ? 'status' : state.status === 'invalid' || state.status === 'error' ? 'alert' : undefined;
  const Heading = headingLevel === 2 ? 'h2' : 'h1';
  const signInHref = returnTo == null
    ? '/login'
    : `/login?callbackURL=${encodeURIComponent(normalizeLoginCallback(returnTo))}`;

  return (
    <section
      aria-labelledby="join-form-title"
      data-auth-panel="join"
      data-auth-state={state.status}
      aria-busy={isChecking || isSigningIn}
      className={cn(
        'studio-auth-panel relative w-full max-w-md rounded-xl border border-dotted border-border bg-card/80 p-5 shadow-none dark:border-border/70 dark:bg-card/60 sm:p-6',
        className,
      )}
    >
      <div className="mb-5 border-b border-border/70 pb-4">
        <Heading id="join-form-title" className="text-xl font-semibold leading-tight sm:text-2xl">
          {copy.joinTitle}
        </Heading>
        <p role={messageRole} aria-live="polite" className={cn(
          'mt-1.5 text-sm leading-relaxed',
          state.status === 'invalid' || state.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
        )}>
          {message}
        </p>
      </div>

      {showCodeForm ? (
        <form
          className="mb-4 space-y-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            void validateSharedCode(code);
          }}
        >
          <label htmlFor="enrollment-code" className="text-sm font-medium">
            {copy.joinCodeLabel}
          </label>
          <div className="flex gap-2">
            <Input
              id="enrollment-code"
              name="code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value.toUpperCase());
                if (state.status === 'invalid' || state.status === 'error') {
                  setState({ status: 'code-entry' });
                }
              }}
              placeholder={copy.joinCodePlaceholder}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={40}
              disabled={isChecking}
              aria-invalid={state.status === 'invalid' || state.status === 'error'}
              className="h-11 min-w-0 rounded-lg border-dotted bg-background/40 font-mono text-sm tracking-[0.08em]"
            />
            <Button
              type="submit"
              variant="outline"
              className="h-11 shrink-0 rounded-lg px-3"
              disabled={isChecking || !code.trim()}
            >
              {isChecking ? copy.checkingCode : copy.checkCode}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="space-y-2.5">
        <Button
          className="h-11 w-full rounded-lg font-medium"
          disabled={!canStartGoogle || isSigningIn}
          onClick={() => void startGoogleEnrollment()}
          type="button"
        >
          <GoogleIcon aria-hidden="true" data-provider-icon="google" className="size-4" />
          {isSigningIn ? copy.openingGoogle : copy.continueGoogle}
        </Button>
        {state.status === 'error' && state.retry === 'code' ? (
          <Button
            className="h-11 w-full rounded-lg font-medium"
            onClick={() => {
              if (token) void validateLegacyInvitation(token);
              else void validateSharedCode(code);
            }}
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
          href={signInHref}
        >
          {copy.signInTitle}
        </Link>
      </div>
    </section>
  );
}

export { normalizeCode, readHashCode, scrubHash };
