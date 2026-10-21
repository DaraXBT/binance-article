'use client';

import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldOff,
} from 'lucide-react';

import { useLanguage } from '@/components/language-provider';
import {
  revealOneTimeValue,
  SettingsGroup,
  StatusBadge,
} from '@/components/settings/settings-primitives';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import {
  formatAccountSettingsDate,
  getAccountSettingsCopy,
} from '@/lib/account-settings-i18n';
import { readSettingsResponse } from '@/lib/settings-api';
import { cn } from '@/lib/utils';

interface PublisherDevicePairing {
  deviceId: string;
  pairingCode: string;
  tokenPrefix: string;
  expiresAt: string;
}

interface PairingCodeIdentity {
  generation: number;
  value: string;
}

type PublisherDeviceStatus = 'pending' | 'active' | 'revoked';

interface PublisherDevice {
  id: string;
  name: string;
  status: PublisherDeviceStatus;
  protocolVersion: number;
  lastSeenAt: string | null;
}

type PairingState =
  | { status: 'idle' }
  | { status: 'creating' }
  | { status: 'ready'; pairing: PublisherDevicePairing }
  | { status: 'error' };

type DevicesState =
  | { status: 'idle' }
  | { status: 'loading'; devices: PublisherDevice[] | null }
  | { status: 'ready'; devices: PublisherDevice[] }
  | { status: 'error'; devices: PublisherDevice[] | null };

type CopyState = 'idle' | 'code' | 'commands' | 'error';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPairingResponse(value: unknown): PublisherDevicePairing {
  if (
    !isRecord(value)
    || typeof value.deviceId !== 'string'
    || typeof value.pairingCode !== 'string'
    || typeof value.tokenPrefix !== 'string'
    || typeof value.expiresAt !== 'string'
    || Number.isNaN(Date.parse(value.expiresAt))
  ) {
    throw new TypeError('Pairing response is invalid.');
  }
  return {
    deviceId: value.deviceId,
    pairingCode: value.pairingCode,
    tokenPrefix: value.tokenPrefix,
    expiresAt: value.expiresAt,
  };
}

function readPublisherDevice(value: unknown): PublisherDevice {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || !['pending', 'active', 'revoked'].includes(String(value.status))
    || !Number.isInteger(value.protocolVersion)
    || Number(value.protocolVersion) <= 0
    || (
      value.lastSeenAt !== null
      && (
        typeof value.lastSeenAt !== 'string'
        || Number.isNaN(Date.parse(value.lastSeenAt))
      )
    )
  ) {
    throw new TypeError('Publisher device response is invalid.');
  }
  return {
    id: value.id,
    name: value.name,
    status: value.status as PublisherDeviceStatus,
    protocolVersion: Number(value.protocolVersion),
    lastSeenAt: value.lastSeenAt,
  };
}

function readDevicesResponse(value: unknown): PublisherDevice[] {
  if (!isRecord(value) || !Array.isArray(value.devices)) {
    throw new TypeError('Publisher devices response is invalid.');
  }
  return value.devices.map(readPublisherDevice);
}

function SetupStep({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 text-xs font-semibold text-foreground"
      >
        {number}
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <p className="text-sm font-medium leading-6 text-foreground">{title}</p>
          {description ? (
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {children}
      </div>
    </li>
  );
}

export function PublisherDevicePairingCard({
  className,
  onUncopiedPairingChange,
}: {
  className?: string;
  onUncopiedPairingChange?: (hasUncopiedPairing: boolean) => void;
}) {
  const { language } = useLanguage();
  const copy = useMemo(() => getAccountSettingsCopy(language), [language]);
  const [pairing, setPairing] = useState<PairingState>({ status: 'idle' });
  const [devices, setDevices] = useState<DevicesState>({ status: 'idle' });
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [pairingCodeCopied, setPairingCodeCopied] = useState(false);
  const [deviceName, setDeviceName] = useState(() => copy.t('defaultComputerName'));
  const [appOrigin, setAppOrigin] = useState('https://your-app.example');
  const [replaceConfirmationOpen, setReplaceConfirmationOpen] = useState(false);
  const [replacementPending, setReplacementPending] = useState(false);
  const [replacementError, setReplacementError] = useState<string | null>(null);
  const [deviceToRevoke, setDeviceToRevoke] = useState<PublisherDevice | null>(null);
  const pairingCodeCopiedRef = useRef(false);
  const pairingGenerationRef = useRef(0);
  const currentPairingIdentityRef = useRef<PairingCodeIdentity | null>(null);
  const pairingRequestPendingRef = useRef(false);
  const devicesRequestGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const revokeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const revokeRowRef = useRef<HTMLLIElement | null>(null);
  const revokeSucceededRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [pairingAnnouncement, setPairingAnnouncement] = useState('');

  const loadDevices = useCallback(async (signal?: AbortSignal) => {
    const requestGeneration = devicesRequestGenerationRef.current + 1;
    devicesRequestGenerationRef.current = requestGeneration;
    setDevices((current) => ({
      status: 'loading',
      devices: 'devices' in current ? current.devices : null,
    }));
    setDeviceError(null);
    try {
      const response = await fetch('/api/publisher/devices', {
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      });
      const body = await readSettingsResponse<unknown>(
        response,
        copy.t('computersCouldNotLoad'),
      );
      if (
        !mountedRef.current
        || devicesRequestGenerationRef.current !== requestGeneration
      ) return;
      setDevices({ status: 'ready', devices: readDevicesResponse(body) });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (
        !mountedRef.current
        || devicesRequestGenerationRef.current !== requestGeneration
      ) return;
      setDevices((current) => ({
        status: 'error',
        devices: 'devices' in current ? current.devices : null,
      }));
    }
  }, [copy]);

  useEffect(() => {
    mountedRef.current = true;
    setAppOrigin(window.location.origin);
    const controller = new AbortController();
    void loadDevices(controller.signal);
    return () => {
      mountedRef.current = false;
      devicesRequestGenerationRef.current += 1;
      controller.abort();
    };
  }, [loadDevices]);

  const companionCommands = useMemo(() => [
    'cd publisher-companion',
    `bun run src/main.ts pair --api ${appOrigin}`,
    'bun run src/main.ts run',
  ].join('\n'), [appOrigin]);

  const performCreatePairing = async () => {
    if (
      !deviceName.trim()
      || pairing.status === 'creating'
      || replacementPending
      || pairingRequestPendingRef.current
    ) return;

    const existingPairing = pairing.status === 'ready' ? pairing.pairing : null;
    const replacingExistingPairing = existingPairing !== null;
    const existingPairingWasUncopied = replacingExistingPairing
      && !pairingCodeCopiedRef.current;
    pairingRequestPendingRef.current = true;
    if (replacingExistingPairing) {
      setReplacementPending(true);
      setReplacementError(null);
    } else {
      setPairing({ status: 'creating' });
      setCopyState('idle');
    }
    // The server may create the one-time code before the response reaches the
    // browser, so protect the dialog from dismissal for the entire request.
    onUncopiedPairingChange?.(true);
    try {
      const response = await fetch('/api/publisher/devices/pairing', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: deviceName.trim() }),
      });
      const body = await readSettingsResponse<unknown>(
        response,
        copy.t('pairingCouldNotCreate'),
      );
      if (!mountedRef.current) return;
      const created = readPairingResponse(body);
      const generation = pairingGenerationRef.current + 1;
      pairingGenerationRef.current = generation;
      currentPairingIdentityRef.current = {
        generation,
        value: created.pairingCode,
      };
      pairingCodeCopiedRef.current = false;
      setPairing({ status: 'ready', pairing: created });
      setCopyState('idle');
      setPairingCodeCopied(false);
      onUncopiedPairingChange?.(true);
      devicesRequestGenerationRef.current += 1;
      setDevices((current) => ({
        status: 'ready',
        devices: [
          {
            id: created.deviceId,
            name: deviceName.trim(),
            status: 'pending',
            protocolVersion: 2,
            lastSeenAt: null,
          },
          ...('devices' in current && current.devices
            ? current.devices.filter((device) => device.id !== created.deviceId)
            : []),
        ],
      }));
      setReplacementError(null);
      setReplaceConfirmationOpen(false);
      setPairingAnnouncement(copy.t('pairingCodeCreated'));
      // Bring the new one-time code into view and focus it.
      window.requestAnimationFrame(() => revealOneTimeValue(rootRef.current));
    } catch {
      if (!mountedRef.current) return;
      if (replacingExistingPairing) {
        setReplacementError(
          copy.t('replacementCouldNotCreate'),
        );
        setReplaceConfirmationOpen(true);
        onUncopiedPairingChange?.(existingPairingWasUncopied);
      } else {
        setPairing({ status: 'error' });
        onUncopiedPairingChange?.(false);
      }
    } finally {
      pairingRequestPendingRef.current = false;
      if (replacingExistingPairing && mountedRef.current) setReplacementPending(false);
    }
  };

  const createPairing = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pairing.status === 'ready' && !pairingCodeCopiedRef.current) {
      setReplaceConfirmationOpen(true);
      return;
    }
    void performCreatePairing();
  };

  const copyText = async (kind: 'code' | 'commands', value: string) => {
    const pairingIdentity = kind === 'code' ? currentPairingIdentityRef.current : null;
    const copyStillTargetsCurrentPairing = () => {
      const currentIdentity = currentPairingIdentityRef.current;
      return mountedRef.current
        && pairingIdentity !== null
        && currentIdentity !== null
        && pairingIdentity.generation === currentIdentity.generation
        && pairingIdentity.value === value
        && currentIdentity.value === value
        && !pairingRequestPendingRef.current;
    };

    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is unavailable.');
      await navigator.clipboard.writeText(value);
      if (kind === 'code') {
        if (!copyStillTargetsCurrentPairing()) return;
        pairingCodeCopiedRef.current = true;
        setPairingCodeCopied(true);
        setCopyState('code');
        onUncopiedPairingChange?.(false);
        return;
      }
      setCopyState('commands');
    } catch {
      if (kind === 'code' && !copyStillTargetsCurrentPairing()) return;
      setCopyState('error');
    }
  };

  const revokeDevice = async (device: PublisherDevice) => {
    if (device.status === 'revoked' || revokingDeviceId) return;
    setRevokingDeviceId(device.id);
    setDeviceError(null);
    setDeviceNotice(null);
    try {
      const response = await fetch(`/api/publisher/devices/${encodeURIComponent(device.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const body = await readSettingsResponse<unknown>(
        response,
        copy.t('deviceCouldNotRevoke', { name: device.name }),
      );
      if (!isRecord(body) || body.revoked !== true) {
        throw new Error('Publisher device revocation failed.');
      }
      revokeSucceededRef.current = true;
      setDeviceNotice(copy.t('deviceRevokedNotice', { name: device.name }));
      devicesRequestGenerationRef.current += 1;
      setDevices((current) => 'devices' in current && current.devices
        ? {
            status: 'ready',
            devices: current.devices.map((candidate) => candidate.id === device.id
              ? { ...candidate, status: 'revoked' }
              : candidate),
          }
        : current);
      setDeviceToRevoke(null);
    } catch {
      setDeviceError(copy.t('deviceCouldNotRevoke', { name: device.name }));
    } finally {
      setRevokingDeviceId(null);
    }
  };

  const pairingValue = pairing.status === 'ready' ? pairing.pairing : null;
  const pairingRequestPending = pairing.status === 'creating' || replacementPending;
  const displayedDevices = 'devices' in devices ? devices.devices : null;

  return (
    <div
      ref={rootRef}
      data-publisher-device-pairing
      className={cn('w-full space-y-6', className)}
    >
      <SettingsGroup title={copy.t('addComputer')} titleId="publisher-add-title">
        <ol className="space-y-6">
          <SetupStep number={1} title={copy.t('setupInstallTitle')} description={copy.t('setupInstallDescription')}>
            <code className="inline-block rounded-md border border-border/80 bg-muted/40 px-2.5 py-1 font-mono text-xs text-foreground">
              node install.mjs
            </code>
          </SetupStep>

          <SetupStep number={2} title={copy.t('setupPairTitle')}>
            <form className="space-y-3" onSubmit={createPairing}>
              <label className="block max-w-md space-y-1.5" htmlFor="publisher-device-name">
                <span className="text-sm font-medium">{copy.t('computerName')}</span>
                <Input
                  id="publisher-device-name"
                  name="deviceName"
                  value={deviceName}
                  maxLength={80}
                  autoComplete="off"
                  onChange={(event) => setDeviceName(event.currentTarget.value)}
                  placeholder={copy.t('computerPlaceholder')}
                  disabled={pairingRequestPending}
                />
              </label>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Button
                  type="submit"
                  variant={pairingValue ? 'outline' : 'default'}
                  disabled={pairingRequestPending || deviceName.trim().length === 0}
                >
                  {pairingRequestPending ? (
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <KeyRound aria-hidden="true" className="size-4" />
                  )}
                  {pairingRequestPending
                    ? copy.t('creatingCode')
                    : pairingValue
                      ? copy.t('createNewCode')
                      : copy.t('createPairingCode')}
                </Button>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {copy.t('codeExpires')}
                </p>
              </div>
              {pairing.status === 'error' ? (
                <p className="text-sm text-destructive" role="alert">
                  {copy.t('pairingCouldNotCreate')}
                </p>
              ) : null}
            </form>
          </SetupStep>

          <SetupStep number={3} title={copy.t('setupStartTitle')} description={copy.t('setupStartDescription')}>
            {pairingValue ? (
              <div
                data-one-time-code-panel
                className="space-y-4 rounded-lg border border-border bg-muted/30 p-4"
              >
                <section className="space-y-2" aria-labelledby="publisher-pairing-code-title">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h4
                        id="publisher-pairing-code-title"
                        tabIndex={-1}
                        data-one-time-code-focus
                        className="text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        {copy.t('oneTimePairingCode')}
                      </h4>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {copy.t('validUntil', {
                          time: formatAccountSettingsDate(language, pairingValue.expiresAt, '', {
                            hour: '2-digit',
                            minute: '2-digit',
                          }),
                        })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={copyState === 'code' ? 'outline' : 'default'}
                      disabled={pairingRequestPending}
                      onClick={() => void copyText('code', pairingValue.pairingCode)}
                    >
                      {copyState === 'code' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                      {copyState === 'code' ? copy.t('copiedCode') : copy.t('copyCode')}
                    </Button>
                  </div>
                  <code
                    data-pairing-code
                    className="block select-all break-all rounded-md border border-border/70 bg-card px-3 py-2.5 font-mono text-sm leading-relaxed text-foreground"
                  >
                    {pairingValue.pairingCode}
                  </code>
                </section>

                <section className="space-y-2" aria-labelledby="publisher-companion-commands-title">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 id="publisher-companion-commands-title" className="text-sm font-semibold">
                      {copy.t('companionCommands')}
                    </h4>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void copyText('commands', companionCommands)}
                    >
                      {copyState === 'commands' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                      {copyState === 'commands' ? copy.t('copiedCommands') : copy.t('copyCommands')}
                    </Button>
                  </div>
                  <pre className="overflow-x-auto rounded-md border border-border/70 bg-card p-3 font-mono text-xs leading-6 text-foreground">
                    <code>{companionCommands}</code>
                  </pre>
                </section>
                {copyState === 'error' ? (
                  <p className="text-xs text-destructive" role="alert">
                    {copy.t('clipboardUnavailable')}
                  </p>
                ) : null}
              </div>
            ) : null}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {copy.t('companionSecurity')}
            </p>
          </SetupStep>
        </ol>
        {pairingAnnouncement && pairingValue ? (
          <p className="sr-only" role="status">{pairingAnnouncement}</p>
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        title={copy.t('publishingComputers')}
        titleId="publisher-devices-title"
        description={copy.t('publishingComputersDescription')}
        actions={(
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={devices.status === 'loading' || revokingDeviceId !== null}
            onClick={() => void loadDevices()}
          >
            {devices.status === 'loading' ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <RefreshCw aria-hidden="true" className="size-4" />
            )}
            {copy.t('refresh')}
          </Button>
        )}
      >
        <div className="space-y-3">
          {devices.status === 'loading' ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              {copy.t('loadingPublishingComputers')}
            </p>
          ) : null}

          {devices.status === 'error' ? (
            <p className="text-sm text-destructive" role="alert">
              {copy.t('computersCouldNotLoad')}
            </p>
          ) : null}

          {deviceNotice ? (
            <p className="sr-only" role="status">{deviceNotice}</p>
          ) : null}

          {devices.status === 'ready' && devices.devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{copy.t('noPublishingComputers')}</p>
          ) : null}

          {displayedDevices && displayedDevices.length > 0 ? (
            <ul className="divide-y divide-border/70 rounded-lg border border-border/70">
              {displayedDevices.map((device) => {
                const isRevoking = revokingDeviceId === device.id;
                const needsUpdate = device.status === 'active' && device.protocolVersion < 2;
                return (
                  <li
                    key={device.id}
                    aria-label={copy.t('publisherDevice', { name: device.name })}
                    tabIndex={-1}
                    className={cn(
                      'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-3 outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 sm:px-4',
                      device.status === 'revoked' && 'text-muted-foreground',
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{device.name}</p>
                        <StatusBadge
                          tone={device.status === 'active' ? 'success' : device.status === 'pending' ? 'info' : 'neutral'}
                        >
                          {device.status === 'active'
                            ? copy.t('deviceActive')
                            : device.status === 'pending'
                              ? copy.t('devicePending')
                              : copy.t('deviceRevoked')}
                        </StatusBadge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {device.lastSeenAt ? (
                          <>
                            {copy.t('lastSeen', { date: '' })}{' '}
                            <time dateTime={device.lastSeenAt}>
                              {formatAccountSettingsDate(language, device.lastSeenAt, copy.t('neverSeen'))}
                            </time>
                          </>
                        ) : copy.t('neverSeen')}
                      </p>
                      {needsUpdate ? (
                        <p className="text-xs font-medium text-foreground">
                          {copy.t('updateNeeded')}
                        </p>
                      ) : null}
                    </div>
                    {device.status !== 'revoked' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={`${copy.t('revoke')} ${device.name}`}
                        disabled={revokingDeviceId !== null}
                        onClick={(event) => {
                          revokeTriggerRef.current = event.currentTarget;
                          revokeRowRef.current = event.currentTarget.closest('li');
                          revokeSucceededRef.current = false;
                          setDeviceError(null);
                          setDeviceToRevoke(device);
                        }}
                      >
                        {isRevoking ? (
                          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                        ) : (
                          <ShieldOff aria-hidden="true" className="size-4" />
                        )}
                        {isRevoking ? copy.t('revoking') : copy.t('revoke')}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </SettingsGroup>

      <AlertDialog
        open={replaceConfirmationOpen}
        onOpenChange={(nextOpen) => {
          if (replacementPending) return;
          setReplaceConfirmationOpen(nextOpen);
          if (!nextOpen) setReplacementError(null);
        }}
      >
        <AlertDialogContent className="console-dialog border-dotted p-4 sm:max-w-md sm:p-5">
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.t('newPairingCodeQuestion')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pairingCodeCopied
                ? copy.t('currentCodeCopied')
                : copy.t('currentCodeNotCopied')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {replacementError ? (
            <p
              role="alert"
              className="border border-dotted border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive"
            >
              {replacementError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={replacementPending}>{copy.t('reviewCurrentCode')}</AlertDialogCancel>
            <Button
              type="button"
              disabled={replacementPending}
              onClick={() => void performCreatePairing()}
            >
              {replacementPending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              {replacementPending
                ? copy.t('creating')
                : replacementError
                  ? copy.t('tryAgain')
                  : copy.t('replaceCode')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deviceToRevoke !== null}
        onOpenChange={(nextOpen) => {
          if (nextOpen || revokingDeviceId !== null) return;
          setDeviceToRevoke(null);
          setDeviceError(null);
        }}
      >
        <AlertDialogContent
          className="console-dialog border-dotted p-4 sm:max-w-md sm:p-5"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const preferredTarget = revokeSucceededRef.current
              ? revokeRowRef.current
              : revokeTriggerRef.current;
            const focusTarget = preferredTarget?.isConnected
              ? preferredTarget
              : document.getElementById('publisher-devices-title');
            revokeSucceededRef.current = false;
            focusTarget?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.t('revokeComputerQuestion')}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.t('computerNoLongerReceives', {
                name: deviceToRevoke?.name ?? copy.t('thisComputer'),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deviceError ? (
            <p
              role="alert"
              className="border border-dotted border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive"
            >
              {deviceError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokingDeviceId !== null}>{copy.t('cancel')}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={revokingDeviceId !== null || deviceToRevoke === null}
              onClick={() => {
                if (deviceToRevoke) void revokeDevice(deviceToRevoke);
              }}
            >
              {revokingDeviceId ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <ShieldOff aria-hidden="true" className="size-4" />
              )}
              {revokingDeviceId ? copy.t('revoking') : copy.t('revoke')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
