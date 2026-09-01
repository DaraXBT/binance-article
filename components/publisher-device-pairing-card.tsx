'use client';

import {
  type FormEvent,
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
  MonitorUp,
  RefreshCw,
  ShieldOff,
  TerminalSquare,
} from 'lucide-react';

import { useLanguage } from '@/components/language-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
  const devicesHeadingRef = useRef<HTMLHeadingElement | null>(null);

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
    'bun install --frozen-lockfile',
    'bun run doctor',
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
            protocolVersion: 1,
            lastSeenAt: null,
          },
          ...('devices' in current && current.devices
            ? current.devices.filter((device) => device.id !== created.deviceId)
            : []),
        ],
      }));
      setReplacementError(null);
      setReplaceConfirmationOpen(false);
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
    <Card
      data-publisher-device-pairing
      className={cn('w-full max-w-2xl border-border/70 shadow-none', className)}
    >
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/40">
            <MonitorUp aria-hidden="true" className="size-4 text-primary" />
          </span>
          <div className="space-y-1.5">
            <CardTitle>{copy.t('browserPublisher')}</CardTitle>
            <CardDescription className="max-w-xl leading-relaxed">
              {copy.t('browserPublisherDescription')}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <form className="space-y-3" onSubmit={createPairing}>
            <label className="block space-y-1.5" htmlFor="publisher-device-name">
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
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
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
        </form>

        <section
            className="space-y-3 border-t border-dotted border-border/80 pt-5"
            aria-labelledby="publisher-devices-title"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4
                  ref={devicesHeadingRef}
                  id="publisher-devices-title"
                  tabIndex={-1}
                  className="text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {copy.t('publishingComputers')}
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {copy.t('publishingComputersDescription')}
                </p>
              </div>
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
            </div>

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
              <ul className="space-y-2">
                {displayedDevices.map((device) => {
                  const isRevoking = revokingDeviceId === device.id;
                  return (
                    <li
                      key={device.id}
                      aria-label={copy.t('publisherDevice', { name: device.name })}
                      tabIndex={-1}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/75 bg-muted/20 p-3 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <div className="min-w-0 space-y-1.5">
                        <p className="truncate text-sm font-medium">{device.name}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge
                            variant={device.status === 'active'
                              ? 'secondary'
                              : device.status === 'revoked'
                                ? 'outline'
                                : 'default'}
                            className="rounded-full"
                          >
                            {device.status === 'active'
                              ? copy.t('deviceActive')
                              : device.status === 'pending'
                                ? copy.t('devicePending')
                                : copy.t('deviceRevoked')}
                          </Badge>
                          <span>{copy.t('protocol', { version: device.protocolVersion })}</span>
                          <span aria-hidden="true">·</span>
                          {device.lastSeenAt ? (
                            <span>
                              {copy.t('lastSeen', { date: '' })}{' '}
                              <time dateTime={device.lastSeenAt}>
                                {formatAccountSettingsDate(language, device.lastSeenAt, copy.t('neverSeen'))}
                              </time>
                            </span>
                          ) : (
                            <span>{copy.t('neverSeen')}</span>
                          )}
                        </div>
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

        </section>

        {pairing.status === 'error' ? (
          <p className="text-sm text-destructive" role="alert">
            {copy.t('pairingCouldNotCreate')}
          </p>
        ) : null}

        {pairingValue ? (
          <div className="space-y-5 border-t border-dotted border-border/80 pt-5">
            <section className="space-y-2" aria-labelledby="publisher-pairing-code-title">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 id="publisher-pairing-code-title" className="text-sm font-semibold">
                    {copy.t('oneTimePairingCode')}
                  </h4>
                  <p className="mt-1 text-xs text-muted-foreground">
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
                  variant="outline"
                  disabled={pairingRequestPending}
                  onClick={() => void copyText('code', pairingValue.pairingCode)}
                >
                  {copyState === 'code' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  {copyState === 'code' ? copy.t('copiedCode') : copy.t('copyCode')}
                </Button>
              </div>
              <code
                data-pairing-code
                className="block select-all break-all rounded-lg border border-primary/35 bg-primary/5 px-3 py-3 font-mono text-sm leading-relaxed text-foreground"
              >
                {pairingValue.pairingCode}
              </code>
            </section>

            <section className="space-y-2" aria-labelledby="publisher-companion-commands-title">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 id="publisher-companion-commands-title" className="flex items-center gap-2 text-sm font-semibold">
                    <TerminalSquare aria-hidden="true" className="size-4 text-primary" />
                    {copy.t('companionCommands')}
                  </h4>
                  <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                    {copy.t('companionCommandsDescription')}
                  </p>
                </div>
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
              <pre className="overflow-x-auto rounded-lg border border-border/80 bg-muted/35 p-3 font-mono text-xs leading-6 text-foreground">
                <code>{companionCommands}</code>
              </pre>
            </section>

            <p className="text-xs leading-relaxed text-muted-foreground">
              {copy.t('companionSecurity')}
            </p>
          </div>
        ) : null}

        {copyState === 'error' ? (
          <p className="text-xs text-destructive" role="alert">
            {copy.t('clipboardUnavailable')}
          </p>
        ) : null}
      </CardContent>

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
              : devicesHeadingRef.current;
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

    </Card>
  );
}
