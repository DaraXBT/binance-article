'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { useLanguage } from '@/components/language-provider';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  revealOneTimeValue,
  SettingsGroup,
  StatusBadge,
  type StatusTone,
} from '@/components/settings/settings-primitives';
import { Button } from '@/components/ui/button';
import {
  accountSettingsErrorMessage,
  formatAccountSettingsDate,
  getAccountSettingsCopy,
  type AccountSettingsCopy,
} from '@/lib/account-settings-i18n';
import { readSettingsResponse, SettingsApiError } from '@/lib/settings-api';
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

const PERSON_STATUS_TONE: Record<UserStatus, StatusTone> = {
  pending: 'info',
  active: 'success',
  suspended: 'warning',
  revoked: 'neutral',
};

function CapacitySummary({ overview, copy }: { overview: EnrollmentOverview; copy: AccountSettingsCopy }) {
  const used = overview.capacity.activeUsers +
    overview.capacity.legacyInvitations +
    overview.capacity.reservedClaims;
  const limit = Math.max(overview.capacity.limit, 1);
  const ratio = used / limit;
  return (
    <div data-capacity-summary className="mt-4 max-w-md space-y-2">
      <p className="text-sm font-medium text-foreground">
        {copy.t('seatsUsed', { used, limit: overview.capacity.limit })}
      </p>
      <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full',
            ratio >= 1 ? 'bg-destructive' : 'bg-foreground/70',
          )}
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {copy.t('seatsBreakdown', {
          active: overview.capacity.activeUsers,
          invited: overview.capacity.legacyInvitations,
          reserved: overview.capacity.reservedClaims,
        })}
      </p>
    </div>
  );
}

function OneTimeCodePanel({
  value,
  copiedValue,
  copied,
  onCopy,
  onDismiss,
  copy,
}: {
  value: OneTimeCode;
  copiedValue: 'code' | 'link' | null;
  copied: boolean;
  onCopy: (kind: 'code' | 'link') => void;
  onDismiss: () => void;
  copy: AccountSettingsCopy;
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  return (
    <div data-one-time-code-panel className="mt-4 space-y-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
      <div>
        <p
          tabIndex={-1}
          data-one-time-code-focus
          className="font-medium text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {copy.t('copyEnrollment')}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {copy.t('copyEnrollmentDescription')}
        </p>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{copy.t('code')}</p>
        <div className="flex min-w-0 items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-md border border-border/70 bg-card px-2.5 py-1.5 font-mono text-xs">
            {value.code}
          </code>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg text-xs" onClick={() => onCopy('code')}>
            {copiedValue === 'code' ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
            {copiedValue === 'code' ? copy.t('copied') : copy.t('copyCode')}
          </Button>
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{copy.t('joinLink')}</p>
        <div className="flex min-w-0 items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-border/70 bg-card px-2.5 py-1.5 font-mono text-xs">
            {value.joinUrl}
          </code>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg text-xs" onClick={() => onCopy('link')}>
            {copiedValue === 'link' ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
            {copiedValue === 'link' ? copy.t('copied') : copy.t('copyLink')}
          </Button>
        </div>
      </div>
      {confirmDiscard ? (
        <div role="alert" className="space-y-2 border-t border-border pt-3">
          <p className="font-medium text-foreground">{copy.t('discardCodeQuestion')}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{copy.t('discardCodeDescription')}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={() => setConfirmDiscard(false)}>
              {copy.t('keepCode')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 rounded-lg text-xs text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
              onClick={onDismiss}
            >
              {copy.t('discardCode')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
          <span className="text-xs text-muted-foreground">
            {value.version ? copy.t('version', { version: value.version }) : copy.t('prefix', { prefix: value.codePrefix })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 rounded-lg text-xs"
            onClick={() => {
              // An uncopied code can never be shown again; confirm first.
              if (copied) onDismiss();
              else setConfirmDiscard(true);
            }}
          >
            {copy.t('dismiss')}
          </Button>
        </div>
      )}
    </div>
  );
}

function PersonActions({
  person,
  busy,
  onAction,
  copy,
}: {
  person: PersonRow;
  busy: boolean;
  onAction: (action: PersonAction) => void;
  copy: AccountSettingsCopy;
}) {
  if (person.isCurrentUser) return null;
  return (
    <div className="flex shrink-0 gap-1.5">
      {person.status === 'active' ? (
        <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg text-xs" aria-label={`${copy.t('suspend')} ${person.name}`} disabled={busy} onClick={() => onAction('suspend')}>
          {copy.t('suspend')}
        </Button>
      ) : null}
      {person.status === 'suspended' || person.status === 'revoked' ? (
        <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg text-xs" aria-label={`${copy.t('restore')} ${person.name}`} disabled={busy} onClick={() => onAction('restore')}>
          {copy.t('restore')}
        </Button>
      ) : null}
      {person.status !== 'revoked' ? (
        <Button type="button" size="sm" variant="dangerOutline" className="h-8 rounded-lg text-xs" aria-label={`${copy.t('revoke')} ${person.name}`} disabled={busy} onClick={() => onAction('revoke')}>
          {copy.t('revoke')}
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
  /** @deprecated Ignored; Account settings no longer draws frame corners. */
  showFrameCorners?: boolean;
}) {
  const { language } = useLanguage();
  const copy = useMemo(() => getAccountSettingsCopy(language), [language]);
  const [overview, setOverview] = useState<EnrollmentOverview | null>(null);
  const [people, setPeople] = useState<PersonRow[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [codeActionError, setCodeActionError] = useState<string | null>(null);
  const [personActionError, setPersonActionError] = useState<string | null>(null);
  const [oneTimeCode, setOneTimeCode] = useState<OneTimeCode | null>(null);
  const [copiedValue, setCopiedValue] = useState<'code' | 'link' | null>(null);
  const [oneTimeCodeCopied, setOneTimeCodeCopied] = useState(false);
  const [codeAnnouncement, setCodeAnnouncement] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [codeAction, setCodeAction] = useState<'create' | 'rotate' | 'disable' | null>(null);
  const [rotationConfirmOpen, setRotationConfirmOpen] = useState(false);
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);
  const [personAction, setPersonAction] = useState<{ person: PersonRow; action: PersonAction } | null>(null);
  const [personActionBusy, setPersonActionBusy] = useState(false);
  const overviewSequenceRef = useRef(0);
  const peopleSequenceRef = useRef(0);
  const hasUncopiedAccessRef = useRef(false);
  const oneTimeCodeRef = useRef<OneTimeCode | null>(null);
  const oneTimeCodeGenerationRef = useRef(0);
  const codeRequestPendingRef = useRef(false);
  const mountedRef = useRef(true);

  const setUncopiedAccess = useCallback((hasUncopiedAccess: boolean) => {
    hasUncopiedAccessRef.current = hasUncopiedAccess;
    onUncopiedAccessChange?.(hasUncopiedAccess);
  }, [onUncopiedAccessChange]);

  const replaceOneTimeCode = useCallback((nextCode: OneTimeCode | null) => {
    oneTimeCodeGenerationRef.current += 1;
    oneTimeCodeRef.current = nextCode;
    setOneTimeCode(nextCode);
    setOneTimeCodeCopied(false);
  }, []);

  const handleOwnerAccessError = useCallback((error: unknown): boolean => {
    if (!(error instanceof SettingsApiError)) return false;
    const code = error.code?.toUpperCase();
    if (code !== 'OWNER_REQUIRED' && code !== 'AUTH_OWNER_REQUIRED') return false;
    setHidden(true);
    return true;
  }, []);

  const refreshOverview = useCallback(async () => {
    const sequence = ++overviewSequenceRef.current;
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const response = await fetch('/api/admin/enrollment', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const overviewBody = await readSettingsResponse<Record<string, unknown>>(
        response,
        copy.t('enrollmentCouldNotLoad'),
      );
      if (overviewSequenceRef.current !== sequence) return;
      setOverview(parseOverview(overviewBody));
    } catch (error) {
      if (overviewSequenceRef.current !== sequence) return;
      if (!handleOwnerAccessError(error)) {
        setOverviewError(accountSettingsErrorMessage(error, copy, 'enrollmentCouldNotLoad'));
      }
    } finally {
      if (overviewSequenceRef.current === sequence) setOverviewLoading(false);
    }
  }, [copy, handleOwnerAccessError]);

  const refreshPeople = useCallback(async () => {
    const sequence = ++peopleSequenceRef.current;
    setPeopleLoading(true);
    setPeopleError(null);
    try {
      const response = await fetch('/api/admin/people', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const peopleBody = await readSettingsResponse<Record<string, unknown>>(
        response,
        copy.t('peopleCouldNotLoad'),
      );
      if (peopleSequenceRef.current !== sequence) return;
      setPeople(parsePeople(peopleBody));
    } catch (error) {
      if (peopleSequenceRef.current !== sequence) return;
      if (!handleOwnerAccessError(error)) {
        setPeopleError(accountSettingsErrorMessage(error, copy, 'peopleCouldNotLoad'));
      }
    } finally {
      if (peopleSequenceRef.current === sequence) setPeopleLoading(false);
    }
  }, [copy, handleOwnerAccessError]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshOverview(), refreshPeople()]);
  }, [refreshOverview, refreshPeople]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const mutateCode = async (action: 'create' | 'rotate') => {
    if (codeAction || codeRequestPendingRef.current) return;
    const hadUncopiedAccess = hasUncopiedAccessRef.current;
    let responseValidated = false;
    codeRequestPendingRef.current = true;
    setCodeAction(action);
    setCodeActionError(null);
    // The server may commit the one-time code before its response reaches the
    // browser, so guard Settings against close/back for the whole request.
    setUncopiedAccess(true);
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
      const body = await readSettingsResponse<Record<string, unknown>>(response, action === 'create'
        ? copy.t('enrollmentCouldNotCreate')
        : copy.t('enrollmentCouldNotRotate'));
      if (!mountedRef.current) return;
      const createdCode = parseOneTimeCode(body);
      replaceOneTimeCode(createdCode);
      setCopiedValue(null);
      responseValidated = true;
      codeRequestPendingRef.current = false;
      if (action === 'rotate') setRotationConfirmOpen(false);
      setCodeAnnouncement(copy.t('enrollmentCodeCreated'));
      // Move focus to the new code so it is noticed before it can be lost.
      window.requestAnimationFrame(() => revealOneTimeValue(rootRef.current));
      // Reveal the replacement immediately. Refreshing surrounding metadata
      // must never keep the only copy trapped behind the rotation modal.
      await refresh();
    } catch (error) {
      codeRequestPendingRef.current = false;
      if (!mountedRef.current) return;
      if (!responseValidated) setUncopiedAccess(hadUncopiedAccess);
      setCodeActionError(accountSettingsErrorMessage(error, copy, 'enrollmentCouldNotUpdate'));
    } finally {
      codeRequestPendingRef.current = false;
      if (mountedRef.current) setCodeAction(null);
    }
  };

  const disableCode = async () => {
    if (codeAction) return;
    setCodeAction('disable');
    setCodeActionError(null);
    try {
      const response = await fetch('/api/admin/enrollment/code', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      await readSettingsResponse<Record<string, unknown>>(
        response,
        copy.t('enrollmentCouldNotDisable'),
      );
      if (!mountedRef.current) return;
      replaceOneTimeCode(null);
      setCopiedValue(null);
      setUncopiedAccess(false);
      setOverview((current) => current ? { ...current, code: null } : current);
      await refresh();
      if (mountedRef.current) setDisableConfirmOpen(false);
    } catch (error) {
      if (!mountedRef.current) return;
      setCodeActionError(accountSettingsErrorMessage(error, copy, 'enrollmentCouldNotDisable'));
    } finally {
      if (mountedRef.current) setCodeAction(null);
    }
  };

  const copySecret = async (kind: 'code' | 'link') => {
    const codeToCopy = oneTimeCode;
    if (!codeToCopy || !navigator.clipboard?.writeText) {
      setCodeActionError(copy.t('clipboardUnavailable'));
      return;
    }
    const codeGeneration = oneTimeCodeGenerationRef.current;
    const copyStillTargetsCurrentCode = () => (
      mountedRef.current
      && !codeRequestPendingRef.current
      && oneTimeCodeGenerationRef.current === codeGeneration
      && oneTimeCodeRef.current === codeToCopy
    );
    setCodeActionError(null);
    try {
      await navigator.clipboard.writeText(kind === 'code' ? codeToCopy.code : codeToCopy.joinUrl);
      if (!copyStillTargetsCurrentCode()) return;
      setCopiedValue(kind);
      setOneTimeCodeCopied(true);
      setUncopiedAccess(false);
      window.setTimeout(() => {
        if (!copyStillTargetsCurrentCode()) return;
        setCopiedValue((current) => current === kind ? null : current);
      }, 2000);
    } catch {
      if (!copyStillTargetsCurrentCode()) return;
      setCodeActionError(copy.t('browserCouldNotCopy'));
    }
  };

  const mutatePerson = async () => {
    if (!personAction || personActionBusy) return;
    const requestedAction = personAction;
    setPersonActionBusy(true);
    setPersonActionError(null);
    try {
      const response = await fetch(`/api/admin/people/${encodeURIComponent(requestedAction.person.id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: requestedAction.action }),
      });
      await readSettingsResponse<Record<string, unknown>>(
        response,
        copy.t('accountCouldNotBe', {
          action: requestedAction.action === 'suspend'
            ? copy.t('statusSuspended').toLowerCase()
            : requestedAction.action === 'restore'
              ? copy.t('restore').toLowerCase()
              : copy.t('statusRevoked').toLowerCase(),
        }),
      );
      const nextStatus: UserStatus = requestedAction.action === 'restore'
        ? 'active'
        : requestedAction.action === 'suspend'
          ? 'suspended'
          : 'revoked';
      setPeople((current) => current?.map((person) => person.id === requestedAction.person.id
        ? { ...person, status: nextStatus }
        : person) ?? current);
      await refresh();
      setPersonAction(null);
    } catch (error) {
      setPersonActionError(accountSettingsErrorMessage(error, copy, 'accountStatusCouldNotChange'));
    } finally {
      setPersonActionBusy(false);
    }
  };

  if (hidden) return null;

  const activeCode = overview?.code?.status === 'active' ? overview.code : null;

  return (
    <div ref={rootRef} data-people-access-card className={cn('w-full space-y-6', className)}>
      <SettingsGroup
        title={copy.t('enrollmentCode')}
        titleId="enrollment-code-title"
        description={activeCode
          ? copy.t('activeCodeMetadata', {
              version: activeCode.version,
              prefix: activeCode.codePrefix,
              date: formatAccountSettingsDate(language, activeCode.createdAt, copy.t('notYet')),
            })
          : overview ? copy.t('noActiveCode') : copy.t('manageSharedCode')}
        actions={overview && activeCode ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 gap-1.5 rounded-lg"
              disabled={codeAction !== null}
              onClick={() => {
                setCodeActionError(null);
                setRotationConfirmOpen(true);
              }}
            >
              <RotateCw aria-hidden="true" className="size-3.5" />
              {copy.t('rotateCode')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="dangerOutline"
              className="h-9 gap-1.5 rounded-lg"
              disabled={codeAction !== null}
              onClick={() => {
                setCodeActionError(null);
                setDisableConfirmOpen(true);
              }}
            >
              <ShieldOff aria-hidden="true" className="size-3.5" />
              {copy.t('disableCode')}
            </Button>
          </>
        ) : overview ? (
          <Button type="button" size="sm" className="h-9 gap-1.5 rounded-lg" disabled={codeAction !== null} onClick={() => void mutateCode('create')}>
            {codeAction === 'create' ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <ShieldCheck aria-hidden="true" className="size-3.5" />}
            {copy.t('createCode')}
          </Button>
        ) : null}
      >
        {activeCode ? (
          <StatusBadge tone="success">{copy.t('statusActive')}</StatusBadge>
        ) : null}
        {overviewLoading ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            {overview ? copy.t('refreshingEnrollment') : copy.t('loadingEnrollment')}
          </p>
        ) : null}
        {overviewError ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <p role="alert">{overviewError}</p>
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg text-xs" disabled={overviewLoading} onClick={() => void refreshOverview()}>
              <RefreshCcw aria-hidden="true" className="size-3.5" />
              {copy.t('retry')}
            </Button>
          </div>
        ) : null}
        {overview ? <CapacitySummary overview={overview} copy={copy} /> : null}
        {oneTimeCode ? (
          <OneTimeCodePanel
            key={oneTimeCode.code}
            value={oneTimeCode}
            copiedValue={copiedValue}
            copied={oneTimeCodeCopied}
            copy={copy}
            onCopy={(kind) => void copySecret(kind)}
            onDismiss={() => {
              replaceOneTimeCode(null);
              setCopiedValue(null);
              setUncopiedAccess(false);
            }}
          />
        ) : null}
        {oneTimeCode && codeAnnouncement ? (
          <p className="sr-only" role="status">{codeAnnouncement}</p>
        ) : null}
        {codeActionError && !rotationConfirmOpen && !disableConfirmOpen ? (
          <p role="alert" className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive">
            {codeActionError}
          </p>
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        title={copy.t('people')}
        titleId="people-list-title"
        description={copy.t('peopleDescription')}
        actions={(
          <Button type="button" size="icon-sm" variant="ghost" className="size-9 rounded-lg" aria-label={copy.t('refreshPeople')} disabled={peopleLoading} onClick={() => void refreshPeople()}>
            <RefreshCcw aria-hidden="true" className={cn('size-4', peopleLoading && 'animate-spin')} />
          </Button>
        )}
      >
        {peopleLoading ? (
          <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            {people ? copy.t('refreshingPeople') : copy.t('loadingPeople')}
          </p>
        ) : null}
        {peopleError ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <p role="alert">{peopleError}</p>
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg text-xs" disabled={peopleLoading} onClick={() => void refreshPeople()}>
              <RefreshCcw aria-hidden="true" className="size-3.5" />
              {copy.t('retry')}
            </Button>
          </div>
        ) : null}
        {people && people.length > 0 ? (
          <ul className="divide-y divide-border/70 rounded-lg border border-border/70">
            {people.map((person) => (
              <li key={person.id} className="flex min-w-0 flex-wrap items-center gap-3 px-3 py-3 sm:px-4">
                <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {(person.name || person.email).slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{person.name}</span>
                    {person.role === 'owner' ? (
                      <StatusBadge tone="neutral">{copy.t('administrator')}</StatusBadge>
                    ) : null}
                    <StatusBadge tone={PERSON_STATUS_TONE[person.status]}>
                      {person.status === 'active'
                        ? copy.t('statusActive')
                        : person.status === 'pending'
                          ? copy.t('statusPending')
                          : person.status === 'suspended'
                            ? copy.t('statusSuspended')
                            : copy.t('statusRevoked')}
                    </StatusBadge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{person.email}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground/80">
                    {copy.t('joined', {
                      date: formatAccountSettingsDate(language, person.createdAt, copy.t('notYet')),
                    })}
                  </p>
                </div>
                <PersonActions
                  person={person}
                  busy={personActionBusy}
                  copy={copy}
                  onAction={(action) => {
                    setPersonActionError(null);
                    setPersonAction({ person, action });
                  }}
                />
              </li>
            ))}
          </ul>
        ) : people && !peopleLoading ? (
          <p className="text-sm text-muted-foreground">{copy.t('noPeople')}</p>
        ) : null}
      </SettingsGroup>

      <AlertDialog
        open={rotationConfirmOpen}
        onOpenChange={(open) => {
          if (!open && codeAction === 'rotate') return;
          setRotationConfirmOpen(open);
          if (!open) setCodeActionError(null);
        }}
      >
        <AlertDialogContent
          className="console-dialog border-dotted p-4 sm:max-w-md sm:p-5"
          onCloseAutoFocus={(event) => {
            if (!oneTimeCodeRef.current) return;
            event.preventDefault();
            revealOneTimeValue(rootRef.current);
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.t('rotateQuestion')}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.t('rotateDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {codeActionError ? (
            <p role="alert" className="rounded-lg border border-dotted border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive">
              {codeActionError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={codeAction === 'rotate'}>{copy.t('keepCurrentCode')}</AlertDialogCancel>
            <Button type="button" disabled={codeAction === 'rotate'} onClick={() => void mutateCode('rotate')}>
              {codeAction === 'rotate' ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <RotateCw aria-hidden="true" className="size-4" />}
              {copy.t('rotateCode')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={disableConfirmOpen}
        onOpenChange={(open) => {
          if (!open && codeAction === 'disable') return;
          setDisableConfirmOpen(open);
          if (!open) setCodeActionError(null);
        }}
      >
        <AlertDialogContent className="console-dialog border-dotted p-4 sm:max-w-md sm:p-5">
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.t('disableQuestion')}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.t('disableDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {codeActionError ? (
            <p role="alert" className="rounded-lg border border-dotted border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive">
              {codeActionError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={codeAction === 'disable'}>{copy.t('keepEnrollmentOpen')}</AlertDialogCancel>
            <Button type="button" variant="destructive" disabled={codeAction === 'disable'} onClick={() => void disableCode()}>
              {codeAction === 'disable' ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <ShieldOff aria-hidden="true" className="size-4" />}
              {copy.t('disableCode')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={personAction !== null}
        onOpenChange={(open) => {
          if (!open && !personActionBusy) {
            setPersonAction(null);
            setPersonActionError(null);
          }
        }}
      >
        <AlertDialogContent className="console-dialog border-dotted p-4 sm:max-w-md sm:p-5">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {copy.t(
                personAction?.action === 'restore'
                  ? 'restorePersonQuestion'
                  : personAction?.action === 'suspend'
                    ? 'suspendPersonQuestion'
                    : 'revokePersonQuestion',
                { name: personAction?.person.name ?? '' },
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {personAction?.action === 'restore'
                ? copy.t('restoreDescription')
                : copy.t('invalidateDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {personActionError ? (
            <p role="alert" className="rounded-lg border border-dotted border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive">
              {personActionError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={personActionBusy}>{copy.t('cancel')}</AlertDialogCancel>
            <Button
              type="button"
              variant={personAction?.action === 'restore' ? 'default' : 'destructive'}
              disabled={personActionBusy}
              onClick={() => void mutatePerson()}
            >
              {personActionBusy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : personAction?.action === 'restore' ? <UserRoundCheck aria-hidden="true" className="size-4" /> : <UserRoundX aria-hidden="true" className="size-4" />}
              {personAction?.action === 'restore' ? copy.t('restore') : personAction?.action === 'suspend' ? copy.t('suspend') : copy.t('revoke')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export { parseOneTimeCode, parseOverview, parsePeople };
