'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, ShieldAlert, XCircle } from 'lucide-react';

import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import type { PublishingMessages } from '@/lib/publishing-i18n';

export type PublicationTarget = 'binance-square' | 'x';
export type PublicationKind = 'post' | 'article';
export type PublicationCommandState =
  | 'queued'
  | 'claimed'
  | 'awaiting_review'
  | 'awaiting_approval'
  | 'approved'
  | 'publishing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'outcome_unknown';

export type PublicationCommand = {
  id: string;
  draftId: string;
  target: PublicationTarget;
  kind?: PublicationKind;
  state: PublicationCommandState;
  revision: number;
  recipeHash: string;
  expiresAt: string | Date;
  resultUrl?: string | null;
  publishedUrl?: string | null;
  failureReason?: string | null;
};

const TERMINAL_STATES = new Set<PublicationCommandState>([
  'succeeded', 'failed', 'cancelled', 'expired', 'outcome_unknown',
]);
const CANCELLABLE_STATES = new Set<PublicationCommandState>([
  'queued', 'claimed', 'awaiting_review', 'awaiting_approval', 'approved',
]);

class LocalizedPublicationError extends Error {}

async function responseJson(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const serverMessage = body
      && typeof body === 'object'
      && 'error' in body
      && typeof body.error === 'string'
      && body.error.trim().length > 0
      && body.error.length <= 500
      ? body.error.trim()
      : fallback;
    throw new LocalizedPublicationError(serverMessage);
  }
  return body;
}

export function usePublicationCommand(
  target: PublicationTarget,
  articleId?: string,
  kind?: PublicationKind,
) {
  const { messages } = useLanguage();
  const copy = messages.publishing.command;
  const [command, setCommand] = useState<PublicationCommand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const storageKey = articleId
    ? kind
      ? `xarticle:publication-command:${target}:${kind}:${articleId}`
      : `xarticle:publication-command:${target}:${articleId}`
    : null;

  const setRememberedCommand = useCallback((next: PublicationCommand) => {
    setCommand(next);
    if (!storageKey) return;
    if (TERMINAL_STATES.has(next.state)) window.sessionStorage.removeItem(storageKey);
    else window.sessionStorage.setItem(storageKey, next.id);
  }, [storageKey]);

  const reset = useCallback(() => {
    setCommand(null);
    setError(null);
    setIsPreparing(false);
    setIsApproving(false);
    setIsCancelling(false);
    if (storageKey) window.sessionStorage.removeItem(storageKey);
  }, [storageKey]);

  useEffect(() => {
    setCommand(null);
    setError(null);
    setIsPreparing(false);
    setIsApproving(false);
    setIsCancelling(false);
    if (!storageKey) return;
    const storedCommandId = window.sessionStorage.getItem(storageKey);
    if (!storedCommandId) return;
    let cancelled = false;

    void fetch(`/api/publisher/commands/${encodeURIComponent(storedCommandId)}`, {
      cache: 'no-store',
    }).then((response) => responseJson(response, copy.statusFailed))
      .then((body) => {
        if (cancelled) return;
        const restored = body.command as PublicationCommand;
        if (
          restored.target !== target ||
          (kind && restored.kind !== kind)
        ) {
          window.sessionStorage.removeItem(storageKey);
          throw new LocalizedPublicationError(copy.targetMismatch);
        }
        setRememberedCommand(restored);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        window.sessionStorage.removeItem(storageKey);
        setError(caught instanceof LocalizedPublicationError ? caught.message : copy.statusFailed);
      });

    return () => { cancelled = true; };
  }, [copy.statusFailed, copy.targetMismatch, kind, setRememberedCommand, storageKey, target]);

  const prepare = useCallback(async (
    action: () => Promise<{ command: PublicationCommand }>,
  ) => {
    setIsPreparing(true);
    setError(null);
    try {
      const result = await action();
      if (
        result.command.target !== target ||
        (kind && result.command.kind !== kind)
      ) {
        throw new LocalizedPublicationError(copy.targetMismatch);
      }
      setRememberedCommand(result.command);
      return result.command;
    } catch (caught) {
      setError(caught instanceof LocalizedPublicationError ? caught.message : copy.preparationFailed);
      return null;
    } finally {
      setIsPreparing(false);
    }
  }, [copy.preparationFailed, copy.targetMismatch, kind, setRememberedCommand, target]);

  const approve = useCallback(async () => {
    if (!command || command.state !== 'awaiting_review') return;
    setIsApproving(true);
    setError(null);
    try {
      const response = await fetch(`/api/publisher/commands/${encodeURIComponent(command.id)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: command.revision,
          recipeHash: command.recipeHash,
          confirmed: true,
        }),
      });
      const body = await responseJson(response, copy.approveFailed);
      setRememberedCommand(body.command as PublicationCommand);
    } catch (caught) {
      setError(caught instanceof LocalizedPublicationError ? caught.message : copy.approveFailed);
    } finally {
      setIsApproving(false);
    }
  }, [command, copy.approveFailed, setRememberedCommand]);

  const cancel = useCallback(async () => {
    if (!command || !CANCELLABLE_STATES.has(command.state)) return;
    setIsCancelling(true);
    setError(null);
    try {
      const response = await fetch(`/api/publisher/commands/${encodeURIComponent(command.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: command.revision,
          recipeHash: command.recipeHash,
          confirmed: true,
        }),
      });
      const body = await responseJson(response, copy.cancelFailed);
      setRememberedCommand(body.command as PublicationCommand);
    } catch (caught) {
      setError(caught instanceof LocalizedPublicationError ? caught.message : copy.cancelFailed);
    } finally {
      setIsCancelling(false);
    }
  }, [command, copy.cancelFailed, setRememberedCommand]);

  const commandId = command?.id;
  const commandState = command?.state;

  useEffect(() => {
    if (!commandId || !commandState || TERMINAL_STATES.has(commandState)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let errorStreak = 0;

    const poll = async () => {
      try {
        const response = await fetch(`/api/publisher/commands/${encodeURIComponent(commandId)}`, {
          cache: 'no-store',
        });
        const body = await responseJson(response, copy.statusFailed);
        if (!cancelled) {
          const next = body.command as PublicationCommand;
          if (
            next.target !== target ||
            (kind && next.kind !== kind)
          ) {
            throw new LocalizedPublicationError(copy.targetMismatch);
          }
          errorStreak = 0;
          setError(null);
          setRememberedCommand(next);
          if (!TERMINAL_STATES.has(next.state)) timer = setTimeout(poll, 1_500);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof LocalizedPublicationError ? caught.message : copy.statusFailed);
          // Back off while the status endpoint keeps failing (3s → 30s cap)
          // instead of hammering it every 3 seconds forever.
          errorStreak += 1;
          const delay = Math.min(3_000 * 2 ** (errorStreak - 1), 30_000);
          timer = setTimeout(poll, delay);
        }
      }
    };

    timer = setTimeout(poll, 750);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [commandId, commandState, copy.statusFailed, copy.targetMismatch, kind, setRememberedCommand, target]);

  return {
    command,
    error,
    isPreparing,
    isApproving,
    isCancelling,
    prepare,
    approve,
    cancel,
    reset,
  };
}

function stateCopy(
  state: PublicationCommandState,
  copy: PublishingMessages['command'],
): string {
  switch (state) {
    case 'queued': return copy.queued;
    case 'claimed': return copy.claimed;
    case 'awaiting_review': return copy.awaitingReview;
    case 'awaiting_approval': return copy.awaitingApproval;
    case 'approved': return copy.approved;
    case 'publishing': return copy.publishing;
    case 'succeeded': return copy.succeeded;
    case 'outcome_unknown': return copy.outcomeUnknown;
    case 'expired': return copy.expired;
    case 'cancelled': return copy.cancelled;
    default: return copy.failed;
  }
}

function failureReasonCopy(
  reason: string,
  copy: PublishingMessages['command'],
): string {
  if (reason === 'X_LOGIN_REQUIRED') return copy.xLoginRequired;
  if (reason === 'X_ARTICLES_UNAVAILABLE') return copy.xArticlesUnavailable;
  return reason;
}

export function PublicationCommandPanel({
  command,
  error,
  isApproving,
  isCancelling,
  onApprove,
  onCancel,
}: {
  command: PublicationCommand | null;
  error: string | null;
  isApproving: boolean;
  isCancelling: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const { messages } = useLanguage();
  const copy = messages.publishing.command;
  if (!command && !error) return null;
  const terminal = command ? TERMINAL_STATES.has(command.state) : false;
  const cancellable = command ? CANCELLABLE_STATES.has(command.state) : false;
  return (
    <div className="space-y-2 border border-dotted border-border bg-muted/20 p-3 text-sm" aria-live="polite">
      {command ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {stateCopy(command.state, copy)}
            </p>
            {!terminal && command.state !== 'awaiting_review' ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin text-primary" />
            ) : null}
            {command.state === 'succeeded' ? <CheckCircle2 aria-hidden="true" className="size-4 text-primary" /> : null}
            {command.state === 'outcome_unknown' ? <ShieldAlert aria-hidden="true" className="size-4 text-[var(--access-signal)]" /> : null}
          </div>
          {command.state === 'awaiting_review' || cancellable ? (
            <div className="flex flex-wrap gap-2">
              {command.state === 'awaiting_review' ? (
                <Button type="button" size="sm" onClick={onApprove} disabled={isApproving || isCancelling}>
                  {isApproving ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                  {copy.approveOneClick}
                </Button>
              ) : null}
              {cancellable ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onCancel}
                  disabled={isApproving || isCancelling}
                >
                  {isCancelling
                    ? <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                    : <XCircle aria-hidden="true" className="size-4" />}
                  {copy.cancelPublication}
                </Button>
              ) : null}
            </div>
          ) : null}
          {command.state === 'succeeded' && (command.publishedUrl || command.resultUrl) ? (
            <a className="inline-flex items-center gap-1 text-xs text-primary underline" href={command.publishedUrl || command.resultUrl || '#'} target="_blank" rel="noreferrer">
              {copy.viewPublished} <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          ) : null}
          {command.failureReason ? (
            <p className="text-xs leading-relaxed text-destructive">
              {failureReasonCopy(command.failureReason, copy)}
            </p>
          ) : null}
        </>
      ) : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export { responseJson as readPublicationResponse };
