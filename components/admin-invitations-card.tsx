'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, MailPlus, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface InvitationRow {
  id: string;
  email: string;
  tokenPrefix: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
}

interface CreatedInvitation {
  email: string;
  joinUrl: string;
  expiresAt: string;
}

async function readJson(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : fallback);
  }
  return body ?? {};
}

const STATUS_STYLES: Record<InvitationRow['status'], string> = {
  pending: 'text-primary',
  accepted: 'text-emerald-600 dark:text-emerald-400',
  revoked: 'text-muted-foreground line-through',
  expired: 'text-muted-foreground',
};

export function AdminInvitationsCard({ className }: { className?: string }) {
  const [invitations, setInvitations] = useState<InvitationRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetch('/api/admin/invitations', { cache: 'no-store' });
      const body = await readJson(response, 'The invitations could not be loaded.');
      setInvitations((body.invitations ?? []) as InvitationRow[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'The invitations could not be loaded.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = async () => {
    const trimmed = email.trim();
    if (!trimmed || isCreating) return;
    setIsCreating(true);
    setActionError(null);
    setCreated(null);
    setCopied(false);
    try {
      const response = await fetch('/api/admin/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const body = await readJson(response, 'The invitation could not be created.');
      const invitation = body.invitation as { joinUrl: string; expiresAt: string };
      setCreated({ email: trimmed, joinUrl: invitation.joinUrl, expiresAt: invitation.expiresAt });
      setEmail('');
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The invitation could not be created.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (invitationId: string) => {
    if (revokingId) return;
    setRevokingId(invitationId);
    setActionError(null);
    try {
      const response = await fetch(`/api/admin/invitations/${encodeURIComponent(invitationId)}`, {
        method: 'DELETE',
      });
      await readJson(response, 'The invitation could not be revoked.');
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The invitation could not be revoked.');
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopy = async () => {
    if (!created || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(created.joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={className}>
      <p className="text-sm text-muted-foreground">
        Invite a teammate by email. The join link is shown once — copy it now;
        only its hash is stored. The private beta caps enrollment at ten
        active users.
      </p>

      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreate();
        }}
      >
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="teammate@example.com"
          aria-label="Invitation email"
          disabled={isCreating}
          className="h-10 max-w-xs rounded-lg border-dotted bg-background/40 text-sm"
        />
        <Button type="submit" size="sm" className="h-10 gap-2 rounded-lg" disabled={isCreating || !email.trim()}>
          {isCreating
            ? <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            : <MailPlus aria-hidden="true" className="size-4" />}
          {isCreating ? 'Creating…' : 'Create invitation'}
        </Button>
      </form>

      {created ? (
        <div className="mt-3 space-y-2 border border-dotted border-primary/35 bg-primary/5 p-3 text-sm">
          <p className="font-medium">
            Invitation for {created.email} — copy the join link now; it will not be shown again.
          </p>
          <div className="flex min-w-0 items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{created.joinUrl}</code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 rounded-lg text-xs"
              onClick={() => void handleCopy()}
            >
              {copied
                ? <Check aria-hidden="true" className="size-3.5" />
                : <Copy aria-hidden="true" className="size-3.5" />}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Expires {new Date(created.expiresAt).toLocaleString()}.
          </p>
        </div>
      ) : null}

      {actionError ? (
        <p role="alert" className="mt-3 border border-dotted border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      <div className="mt-4 border-t border-dotted border-border/70 pt-3">
        {loadError ? (
          <div className="flex items-center justify-between gap-3 text-sm text-destructive">
            <p role="alert">{loadError}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 rounded-lg text-xs"
              onClick={() => void refresh()}
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
              Retry
            </Button>
          </div>
        ) : invitations === null ? (
          <p className="text-sm text-muted-foreground">Loading invitations…</p>
        ) : invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invitations yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {invitations.map((row) => (
              <li
                key={row.id}
                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border border-dotted border-border/75 px-2.5 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{row.email}</span>
                <span className="font-mono text-[0.65rem] text-muted-foreground">{row.tokenPrefix}…</span>
                <span className={`font-mono text-[0.65rem] uppercase tracking-[0.12em] ${STATUS_STYLES[row.status]}`}>
                  {row.status}
                </span>
                {row.status === 'pending' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-lg text-xs"
                    disabled={revokingId !== null}
                    onClick={() => void handleRevoke(row.id)}
                    aria-label={`Revoke invitation for ${row.email}`}
                  >
                    {revokingId === row.id
                      ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                      : 'Revoke'}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
