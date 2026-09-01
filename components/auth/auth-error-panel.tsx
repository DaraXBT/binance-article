'use client';

import Link from 'next/link';
import { CircleAlert } from 'lucide-react';

import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { normalizeLoginCallback } from '@/lib/auth-return-to';
import { cn } from '@/lib/utils';

export type AuthErrorKind =
  | 'signup-disabled'
  | 'cancelled'
  | 'claim-invalid'
  | 'capacity-full'
  | 'account-disabled'
  | 'generic';

export function classifyAuthError(value: unknown): AuthErrorKind | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  // Better Auth normally sends a plain error code, but links copied from
  // provider pages sometimes retain a trailing query delimiter (for example
  // `signup_disabled?`). Ignore that presentation noise while keeping the
  // allowlist closed to arbitrary provider text.
  const code = value.trim().toLowerCase().split(/[?#&\s]/, 1)[0].replace(/-/g, '_');

  if (code === 'signup_disabled' || code === 'signup_not_allowed') {
    return 'signup-disabled';
  }
  if (
    code === 'access_denied' ||
    code === 'oauth_cancelled' ||
    code === 'oauth_canceled' ||
    code === 'cancelled' ||
    code === 'canceled'
  ) {
    return 'cancelled';
  }
  if (
    code.includes('capacity') ||
    code === 'enrollment_full' ||
    code === 'beta_full' ||
    code === 'beta_user_cap_reached'
  ) {
    return 'capacity-full';
  }
  if (
    code === 'account_disabled' ||
    code === 'account_suspended' ||
    code === 'account_revoked'
  ) {
    return 'account-disabled';
  }
  if (
    code.includes('claim') ||
    code.includes('enrollment_code') ||
    code.includes('invitation') ||
    code === 'invalid_code'
  ) {
    return 'claim-invalid';
  }
  return 'generic';
}

export interface AuthErrorPanelProps {
  error: string | null | undefined;
  context?: 'join' | 'sign-in';
  returnTo?: string | null;
  className?: string;
  showAction?: boolean;
}

export function AuthErrorPanel({
  error,
  context = 'sign-in',
  returnTo,
  className,
  showAction = true,
}: AuthErrorPanelProps) {
  const { messages } = useLanguage();
  const copy = messages.auth;
  const kind = classifyAuthError(error);
  if (!kind) return null;

  const description = kind === 'signup-disabled'
    ? copy.authErrorSignupDisabled
    : kind === 'cancelled'
      ? copy.authErrorCancelled
      : kind === 'claim-invalid'
        ? copy.authErrorInvalidClaim
        : kind === 'capacity-full'
          ? copy.authErrorCapacityFull
          : kind === 'account-disabled'
            ? copy.authErrorAccountDisabled
            : copy.authErrorGeneric;
  const actionPath = kind === 'account-disabled' || (
    context === 'sign-in' && (kind === 'cancelled' || kind === 'generic')
  )
    ? '/login'
    : '/join';
  const safeReturnTo = returnTo == null ? null : normalizeLoginCallback(returnTo);
  const actionHref = safeReturnTo == null
    ? actionPath
    : actionPath === '/join'
      ? `/join?returnTo=${encodeURIComponent(safeReturnTo)}`
      : `/login?callbackURL=${encodeURIComponent(safeReturnTo)}`;
  const actionLabel = actionPath === '/join' ? copy.returnToJoin : copy.returnToSignIn;

  return (
    <section
      role="alert"
      aria-labelledby="auth-error-title"
      data-auth-error-kind={kind}
      className={cn(
        'rounded-lg border border-dotted border-destructive/40 bg-destructive/5 p-3 shadow-none',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <h2
            id="auth-error-title"
            className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-destructive"
          >
            {kind === 'account-disabled' ? copy.accountStatus : copy.authErrorTitle}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-destructive">
            {description}
          </p>
          {showAction ? (
            <Button
              asChild
              size="sm"
              variant="outline"
              className="mt-3 h-9 rounded-lg text-foreground"
            >
              <Link href={actionHref}>{actionLabel}</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
