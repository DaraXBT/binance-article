'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Loader2,
  RefreshCcw,
  RotateCw,
  ShieldCheck,
  ShieldOff,
  UserRoundCheck,
  UserRoundX,
} from 'lucide-react';

import { ConsolePanel, FrameCornerHandles } from '@/components/console/secure-console-frame';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type UserStatus = 'pending' | 'active' | 'suspended' | 'revoked';
type PersonAction = 'suspend' | 'revoke' | 'restore';

interface EnrollmentOverview {
  code: {
    version: number;
    codePrefix: string;
    status: 'active' | 'revoked';
    createdAt: string | null;
  } | null;
  capacity: {
    activeUsers: number;
    legacyInvitations: number;
    reservedClaims: number;
    limit: number;
  };
}

interface PersonRow {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'user';
  status: UserStatus;
  enrollmentSource: string | null;
  createdAt: string | null;
  lastActiveAt: string | null;
  isCurrentUser: boolean;
}

interface OneTimeCode {
  code: string;
  joinUrl: string;
  codePrefix: string;
  version: number | null;
}

class AdminAccessApiError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AdminAccessApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberValue(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function stringValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

async function readAdminJson(response: Response, fallback: string): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null);
  const payload = isRecord(body) ? body : {};
  if (!response.ok) {
    throw new AdminAccessApiError(
      typeof payload.error === 'string' ? payload.error : fallback,
      typeof payload.code === 'string' ? payload.code : null,
      response.status,
    );
  }
  return payload;
}

function parseOverview(payload: Record<string, unknown>): EnrollmentOverview {
  const enrollment = isRecord(payload.enrollment) ? payload.enrollment : null;
  const codeCandidate = [
    payload.activeCode,
    payload.code,
    payload.enrollmentCode,
    enrollment?.activeCode,
    enrollment?.code,
  ]
    .find(isRecord) as Record<string, unknown> | undefined;
  const capacity = isRecord(payload.capacity)
    ? payload.capacity
    : isRecord(payload.counts)
      ? payload.counts
      : isRecord(enrollment?.capacity)
        ? enrollment.capacity
        : payload;
  const version = codeCandidate ? numberValue(codeCandidate.version) : null;
  const codePrefix = codeCandidate
    ? stringValue(codeCandidate.codePrefix, codeCandidate.prefix, payload.codePrefix)
    : null;
  const status = codeCandidate?.status === 'revoked' ? 'revoked' : 'active';

  return {
    code: codeCandidate && version !== null && codePrefix
      ? {
          version,
          codePrefix,
          status,
          createdAt: stringValue(codeCandidate.createdAt),
        }
      : null,
    capacity: {
      activeUsers: numberValue(
        capacity.activeUsers,
        capacity.active,
        payload.activeUsers,
      ) ?? 0,
      legacyInvitations: numberValue(
        capacity.legacyInvitations,
        capacity.invitations,
        payload.legacyInvitations,
      ) ?? 0,
      reservedClaims: numberValue(
        capacity.reservedClaims,
        capacity.reserved,
        payload.reservedClaims,
      ) ?? 0,
      limit: numberValue(
        capacity.limit,
        capacity.capacity,
        payload.limit,
        payload.maxUsers,
        enrollment?.limit,
      ) ?? 10,
    },
  };
}

function parsePeople(payload: Record<string, unknown>): PersonRow[] {
  const values = Array.isArray(payload.people)
    ? payload.people
    : Array.isArray(payload.users)
      ? payload.users
      : [];
  return values.flatMap((value): PersonRow[] => {
    if (!isRecord(value)) return [];
    const id = stringValue(value.id, value.userId);
    const email = stringValue(value.email);
    if (!id || !email) return [];
    const rawStatus = stringValue(value.status);
    const status: UserStatus = rawStatus === 'pending' || rawStatus === 'suspended' || rawStatus === 'revoked'
      ? rawStatus
      : 'active';
    return [{
      id,
      email,
      name: stringValue(value.name) ?? email,
      role: value.role === 'owner' ? 'owner' : 'user',
      status,
      enrollmentSource: stringValue(value.enrollmentSource, value.source),
      createdAt: stringValue(value.createdAt),
      lastActiveAt: stringValue(value.lastActiveAt, value.updatedAt),
      isCurrentUser: value.isCurrentUser === true || value.current === true,
    }];
  });
}

function parseOneTimeCode(payload: Record<string, unknown>): OneTimeCode {
  const nested = [
    payload.enrollmentCode,
    payload.accessCode,
    payload.enrollment,
    payload.created,
    payload.code,
  ]
    .find(isRecord) as Record<string, unknown> | undefined;
  const source = nested ?? payload;
  const code = stringValue(source.code, source.rawCode, payload.code);
  if (!code) throw new Error('The server created a code but did not return its one-time value.');
  const joinUrl = stringValue(source.joinUrl, payload.joinUrl) ?? (
    typeof window === 'undefined'
      ? `/join#code=${encodeURIComponent(code)}`
      : `${window.location.origin}/join#code=${encodeURIComponent(code)}`
  );
  return {
    code,
    joinUrl,
    codePrefix: stringValue(source.codePrefix, source.prefix) ?? code.replace(/[^A-Z0-9]/gi, '').slice(4, 12),
    version: numberValue(source.version),
  };
}

function formatDate(value: string | null): string {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Not available';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

const STATUS_STYLES: Record<UserStatus, string> = {
  pending: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  active: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  suspended: 'border-orange-500/35 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  revoked: 'border-border bg-muted text-muted-foreground',
};

function CapacitySummary({ overview }: { overview: EnrollmentOverview }) {
  const used = overview.capacity.activeUsers +
    overview.capacity.legacyInvitations +
    overview.capacity.reservedClaims;
  return (
    <dl className="mt-3 grid grid-cols-2 border border-dotted border-border/75 bg-background/30 text-center sm:grid-cols-4">
      <div className="px-2 py-2.5">
        <dt className="font-mono text-[0.58rem] uppercase tracking-[0.12em] text-muted-foreground">Active</dt>
        <dd className="mt-0.5 text-sm font-semibold">{overview.capacity.activeUsers}</dd>
      </div>
      <div className="border-l border-dotted border-border/75 px-2 py-2.5">
        <dt className="font-mono text-[0.58rem] uppercase tracking-[0.12em] text-muted-foreground">Invited</dt>
        <dd className="mt-0.5 text-sm font-semibold">{overview.capacity.legacyInvitations}</dd>
      </div>
      <div className="border-t border-dotted border-border/75 px-2 py-2.5 sm:border-l sm:border-t-0">
        <dt className="font-mono text-[0.58rem] uppercase tracking-[0.12em] text-muted-foreground">Reserved</dt>
        <dd className="mt-0.5 text-sm font-semibold">{overview.capacity.reservedClaims}</dd>
      </div>
      <div className="border-l border-t border-dotted border-border/75 px-2 py-2.5 sm:border-t-0">
        <dt className="font-mono text-[0.58rem] uppercase tracking-[0.12em] text-muted-foreground">Capacity</dt>
        <dd className="mt-0.5 text-sm font-semibold">{used}/{overview.capacity.limit}</dd>
      </div>
    </dl>
  );
}

function OneTimeCodePanel({
  value,
  copiedValue,
  onCopy,
  onDismiss,
}: {
  value: OneTimeCode;
  copiedValue: 'code' | 'link' | null;
  onCopy: (kind: 'code' | 'link') => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mt-3 space-y-3 border border-dotted border-primary/35 bg-primary/5 p-3 text-sm">
      <div>
        <p className="font-medium">Copy this enrollment code or link now.</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The full code is shown only once. Anyone with it can request an account until you rotate it.
        </p>
      </div>
      <div className="space-y-1.5">
        <p className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Code</p>
        <div className="flex min-w-0 items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-md bg-background/65 px-2 py-1.5 font-mono text-xs">
            {value.code}
          </code>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg text-xs" onClick={() => onCopy('code')}>
            {copiedValue === 'code' ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
            {copiedValue === 'code' ? 'Copied' : 'Copy code'}
          </Button>
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Join link</p>
        <div className="flex min-w-0 items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-background/65 px-2 py-1.5 font-mono text-xs">
            {value.joinUrl}
          </code>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg text-xs" onClick={() => onCopy('link')}>
            {copiedValue === 'link' ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
            {copiedValue === 'link' ? 'Copied' : 'Copy link'}
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-dotted border-primary/25 pt-2">
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-muted-foreground">
          {value.version ? `Version ${value.version}` : `Prefix ${value.codePrefix}`}
        </span>
        <Button type="button" size="sm" variant="ghost" className="h-8 rounded-lg text-xs" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function PersonActions({
  person,
  busy,
  onAction,
}: {
  person: PersonRow;
  busy: boolean;
  onAction: (action: PersonAction) => void;
}) {
  if (person.isCurrentUser) return null;
  return (
    <div className="flex shrink-0 gap-1.5">
      {person.status === 'active' ? (
        <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg text-xs" disabled={busy} onClick={() => onAction('suspend')}>
          Suspend
        </Button>
      ) : null}
      {person.status === 'suspended' || person.status === 'revoked' ? (
        <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg text-xs" disabled={busy} onClick={() => onAction('restore')}>
          Restore
        </Button>
      ) : null}
      {person.status !== 'revoked' ? (
        <Button type="button" size="sm" variant="ghost" className="h-8 rounded-lg text-xs text-destructive hover:text-destructive" disabled={busy} onClick={() => onAction('revoke')}>
          Revoke
        </Button>
      ) : null}
    </div>
  );
}

export function AdminPeopleAccessCard({
  className,
  onUncopiedAccessChange,
}: {
  className?: string;
  onUncopiedAccessChange?: (hasUncopiedAccess: boolean) => void;
}) {
  const [overview, setOverview] = useState<EnrollmentOverview | null>(null);
  const [people, setPeople] = useState<PersonRow[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [oneTimeCode, setOneTimeCode] = useState<OneTimeCode | null>(null);
  const [copiedValue, setCopiedValue] = useState<'code' | 'link' | null>(null);
  const [codeAction, setCodeAction] = useState<'create' | 'rotate' | 'disable' | null>(null);
  const [rotationConfirmOpen, setRotationConfirmOpen] = useState(false);
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);
  const [personAction, setPersonAction] = useState<{ person: PersonRow; action: PersonAction } | null>(null);
  const [personActionBusy, setPersonActionBusy] = useState(false);
  const refreshSequenceRef = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequenceRef.current;
    setLoadError(null);
    try {
      const [overviewResponse, peopleResponse] = await Promise.all([
        fetch('/api/admin/enrollment', { cache: 'no-store', credentials: 'same-origin' }),
        fetch('/api/admin/people', { cache: 'no-store', credentials: 'same-origin' }),
      ]);
      const overviewBody = await readAdminJson(overviewResponse, 'Enrollment access could not be loaded.');
      const peopleBody = await readAdminJson(peopleResponse, 'People could not be loaded.');
      if (refreshSequenceRef.current !== sequence) return;
      setOverview(parseOverview(overviewBody));
      setPeople(parsePeople(peopleBody));
    } catch (error) {
      if (refreshSequenceRef.current !== sequence) return;
      if (error instanceof AdminAccessApiError && (
        error.status === 403 ||
        error.code === 'OWNER_REQUIRED' ||
        error.code === 'AUTH_OWNER_REQUIRED'
      )) {
        setHidden(true);
        return;
      }
      setLoadError(error instanceof Error ? error.message : 'People and access could not be loaded.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutateCode = async (action: 'create' | 'rotate') => {
    if (codeAction) return;
    setCodeAction(action);
    setActionError(null);
    setCopiedValue(null);
    onUncopiedAccessChange?.(true);
    try {
      const response = await fetch(
        action === 'create' ? '/api/admin/enrollment/code' : '/api/admin/enrollment/code/rotate',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: action === 'rotate' ? JSON.stringify({ reason: 'owner_rotation' }) : JSON.stringify({}),
        },
      );
      const body = await readAdminJson(response, action === 'create'
        ? 'The enrollment code could not be created.'
        : 'The enrollment code could not be rotated.');
      setOneTimeCode(parseOneTimeCode(body));
      await refresh();
    } catch (error) {
      onUncopiedAccessChange?.(false);
      setActionError(error instanceof Error ? error.message : 'The enrollment code could not be updated.');
    } finally {
      setCodeAction(null);
      setRotationConfirmOpen(false);
    }
  };

  const disableCode = async () => {
    if (codeAction) return;
    setCodeAction('disable');
    setActionError(null);
    try {
      const response = await fetch('/api/admin/enrollment/code', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      await readAdminJson(response, 'The enrollment code could not be disabled.');
      setOneTimeCode(null);
      setCopiedValue(null);
      onUncopiedAccessChange?.(false);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The enrollment code could not be disabled.');
    } finally {
      setCodeAction(null);
      setDisableConfirmOpen(false);
    }
  };

  const copySecret = async (kind: 'code' | 'link') => {
    if (!oneTimeCode || !navigator.clipboard?.writeText) {
      setActionError('Clipboard access is unavailable. Select and copy the value manually.');
      return;
    }
    try {
      await navigator.clipboard.writeText(kind === 'code' ? oneTimeCode.code : oneTimeCode.joinUrl);
      setCopiedValue(kind);
      onUncopiedAccessChange?.(false);
      window.setTimeout(() => setCopiedValue(null), 2000);
    } catch {
      setActionError('The browser could not copy that value. Select and copy it manually.');
    }
  };

  const mutatePerson = async () => {
    if (!personAction || personActionBusy) return;
    setPersonActionBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/admin/people/${encodeURIComponent(personAction.person.id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: personAction.action }),
      });
      await readAdminJson(response, `The user could not be ${personAction.action}d.`);
      setPersonAction(null);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The user status could not be changed.');
    } finally {
      setPersonActionBusy(false);
    }
  };

  if (hidden) return null;

  const isLoading = overview === null || people === null;
  const activeCode = overview?.code?.status === 'active' ? overview.code : null;

  return (
    <ConsolePanel corners={false} className={className ?? 'rounded-xl bg-card/70 p-3 sm:p-5'}>
      <FrameCornerHandles />
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-dotted border-border/70 pb-2">
        <div>
          <h3 className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em]">
            PEOPLE &amp; ACCESS
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Share one enrollment code, then suspend or revoke individual accounts after they join.
          </p>
        </div>
        <ShieldCheck aria-hidden="true" className="size-4 text-primary" />
      </div>

      {loadError && isLoading ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-dotted border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <p role="alert">{loadError}</p>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg text-xs" onClick={() => void refresh()}>
            <RefreshCcw aria-hidden="true" className="size-3.5" />
            Retry
          </Button>
        </div>
      ) : isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          Loading people and access…
        </p>
      ) : (
        <>
          <section aria-labelledby="enrollment-code-title" className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 id="enrollment-code-title" className="text-sm font-semibold">Shared enrollment code</h4>
                {activeCode ? (
                  <p className="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">
                    Version {activeCode.version} · {activeCode.codePrefix}… · created {formatDate(activeCode.createdAt)}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">No active code. Create one before sharing access.</p>
                )}
              </div>
              {activeCode ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5 rounded-lg" disabled={codeAction !== null} onClick={() => setRotationConfirmOpen(true)}>
                    {codeAction === 'rotate' ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <RotateCw aria-hidden="true" className="size-3.5" />}
                    Rotate code
                  </Button>
                  <Button type="button" size="sm" variant="destructive" className="h-9 gap-1.5 rounded-lg" disabled={codeAction !== null} onClick={() => setDisableConfirmOpen(true)}>
                    {codeAction === 'disable' ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <ShieldOff aria-hidden="true" className="size-3.5" />}
                    Disable code
                  </Button>
                </div>
              ) : (
                <Button type="button" size="sm" className="h-9 gap-1.5 rounded-lg" disabled={codeAction !== null} onClick={() => void mutateCode('create')}>
                  {codeAction === 'create' ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <ShieldCheck aria-hidden="true" className="size-3.5" />}
                  Create code
                </Button>
              )}
            </div>
            {overview ? <CapacitySummary overview={overview} /> : null}
            {oneTimeCode ? (
              <OneTimeCodePanel
                value={oneTimeCode}
                copiedValue={copiedValue}
                onCopy={(kind) => void copySecret(kind)}
                onDismiss={() => {
                  setOneTimeCode(null);
                  setCopiedValue(null);
                  onUncopiedAccessChange?.(false);
                }}
              />
            ) : null}
          </section>

          <section aria-labelledby="people-list-title" className="mt-5 border-t border-dotted border-border/70 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 id="people-list-title" className="text-sm font-semibold">People</h4>
                <p className="mt-1 text-xs text-muted-foreground">Suspension and revocation block access while preserving workspace data.</p>
              </div>
              <Button type="button" size="icon-sm" variant="ghost" className="rounded-lg" aria-label="Refresh people" onClick={() => void refresh()}>
                <RefreshCcw aria-hidden="true" className="size-3.5" />
              </Button>
            </div>

            {people && people.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {people.map((person) => (
                  <li key={person.id} className="flex min-w-0 flex-wrap items-center gap-3 border border-dotted border-border/75 bg-background/25 px-3 py-2.5">
                    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {(person.name || person.email).slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{person.name}</span>
                        {person.role === 'owner' ? <Badge variant="outline" className="rounded-full text-[0.6rem]">Owner</Badge> : null}
                        <Badge variant="outline" className={cn('rounded-full text-[0.6rem] capitalize', STATUS_STYLES[person.status])}>
                          {person.status}
                        </Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{person.email}</p>
                      <p className="mt-0.5 truncate font-mono text-[0.58rem] uppercase tracking-[0.08em] text-muted-foreground/75">
                        Joined {formatDate(person.createdAt)}
                        {person.enrollmentSource ? ` · ${person.enrollmentSource.replace(/_/g, ' ')}` : ''}
                      </p>
                    </div>
                    <PersonActions
                      person={person}
                      busy={personActionBusy}
                      onAction={(action) => setPersonAction({ person, action })}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No enrolled people yet.</p>
            )}
          </section>
        </>
      )}

      {actionError ? (
        <p role="alert" className="mt-3 border border-dotted border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      <AlertDialog open={rotationConfirmOpen} onOpenChange={setRotationConfirmOpen}>
        <AlertDialogContent className="console-dialog border-dotted p-4 sm:max-w-md sm:p-5">
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate the enrollment code?</AlertDialogTitle>
            <AlertDialogDescription>
              The current code and every unfinished enrollment using it will stop working immediately. Existing users keep access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current code</AlertDialogCancel>
            <AlertDialogAction onClick={() => void mutateCode('rotate')}>Rotate code</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={disableConfirmOpen} onOpenChange={setDisableConfirmOpen}>
        <AlertDialogContent className="console-dialog border-dotted p-4 sm:max-w-md sm:p-5">
          <AlertDialogHeader>
            <AlertDialogTitle>Disable the enrollment code?</AlertDialogTitle>
            <AlertDialogDescription>
              The shared code and every unfinished enrollment using it will stop immediately. No replacement is created. Existing users keep access, and legacy invitation links are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={codeAction === 'disable'}>Keep enrollment open</AlertDialogCancel>
            <AlertDialogAction disabled={codeAction === 'disable'} onClick={() => void disableCode()}>
              {codeAction === 'disable' ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <ShieldOff aria-hidden="true" className="size-4" />}
              Disable code
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={personAction !== null} onOpenChange={(open) => { if (!open && !personActionBusy) setPersonAction(null); }}>
        <AlertDialogContent className="console-dialog border-dotted p-4 sm:max-w-md sm:p-5">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {personAction?.action === 'restore'
                ? 'Restore this account?'
                : personAction?.action === 'suspend'
                  ? 'Suspend this account?'
                  : 'Revoke this account?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {personAction?.action === 'restore'
                ? 'The user can sign in again if beta capacity is available.'
                : 'Current sessions and publisher devices will be invalidated. Workspace content is retained.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={personActionBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={personActionBusy} onClick={() => void mutatePerson()}>
              {personActionBusy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : personAction?.action === 'restore' ? <UserRoundCheck aria-hidden="true" className="size-4" /> : <UserRoundX aria-hidden="true" className="size-4" />}
              {personAction?.action === 'restore' ? 'Restore' : personAction?.action === 'suspend' ? 'Suspend' : 'Revoke'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConsolePanel>
  );
}

export { parseOneTimeCode, parseOverview, parsePeople };
