'use client';

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
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

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface PublisherDevicePairing {
  deviceId: string;
  pairingCode: string;
  tokenPrefix: string;
  expiresAt: string;
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
  | { status: 'loading' }
  | { status: 'ready'; devices: PublisherDevice[] }
  | { status: 'error' };

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

async function readResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function PublisherDevicePairingCard({
  className,
  onUncopiedPairingChange,
}: {
  className?: string;
  onUncopiedPairingChange?: (hasUncopiedPairing: boolean) => void;
}) {
  const [pairing, setPairing] = useState<PairingState>({ status: 'idle' });
  const [devices, setDevices] = useState<DevicesState>({ status: 'idle' });
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [deviceName, setDeviceName] = useState('My publishing computer');
  const [appOrigin, setAppOrigin] = useState('https://your-app.example');

  const loadDevices = useCallback(async (signal?: AbortSignal) => {
    setDevices({ status: 'loading' });
    setDeviceError(null);
    try {
      const response = await fetch('/api/publisher/devices', {
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      });
      const body = await readResponseBody(response);
      if (!response.ok) throw new Error('Publisher devices request failed.');
      setDevices({ status: 'ready', devices: readDevicesResponse(body) });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setDevices({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    setAppOrigin(window.location.origin);
    const controller = new AbortController();
    void loadDevices(controller.signal);
    return () => controller.abort();
  }, [loadDevices]);

  const companionCommands = useMemo(() => [
    'cd publisher-companion',
    'bun install --frozen-lockfile',
    'bun run doctor',
    `bun run src/main.ts pair --api ${appOrigin}`,
    'bun run src/main.ts run',
  ].join('\n'), [appOrigin]);

  const createPairing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!deviceName.trim()) return;

    setPairing({ status: 'creating' });
    setCopyState('idle');
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
      const body = await readResponseBody(response);
      if (!response.ok) throw new Error('Pairing request failed.');
      const created = readPairingResponse(body);
      setPairing({ status: 'ready', pairing: created });
      setDevices((current) => current.status === 'ready'
        ? {
            status: 'ready',
            devices: [
              {
                id: created.deviceId,
                name: deviceName.trim(),
                status: 'pending',
                protocolVersion: 1,
                lastSeenAt: null,
              },
              ...current.devices.filter((device) => device.id !== created.deviceId),
            ],
          }
        : current);
    } catch {
      setPairing({ status: 'error' });
      onUncopiedPairingChange?.(false);
    }
  };

  const copyText = async (kind: 'code' | 'commands', value: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is unavailable.');
      await navigator.clipboard.writeText(value);
      setCopyState(kind);
      if (kind === 'code') onUncopiedPairingChange?.(false);
    } catch {
      setCopyState('error');
    }
  };

  const revokeDevice = async (device: PublisherDevice) => {
    if (device.status === 'revoked' || revokingDeviceId) return;
    setRevokingDeviceId(device.id);
    setDeviceError(null);
    try {
      const response = await fetch(`/api/publisher/devices/${encodeURIComponent(device.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const body = await readResponseBody(response);
      if (!response.ok || !isRecord(body) || body.revoked !== true) {
        throw new Error('Publisher device revocation failed.');
      }
      setDevices((current) => current.status === 'ready'
        ? {
            status: 'ready',
            devices: current.devices.map((candidate) => candidate.id === device.id
              ? { ...candidate, status: 'revoked' }
              : candidate),
          }
        : current);
    } catch {
      setDeviceError(`${device.name} could not be revoked. Check the connection and try again.`);
    } finally {
      setRevokingDeviceId(null);
    }
  };

  const pairingValue = pairing.status === 'ready' ? pairing.pairing : null;

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
            <CardTitle>Browser publisher</CardTitle>
            <CardDescription className="max-w-xl leading-relaxed">
              Pair this account with the companion on the computer where Chrome is already signed in to Binance Square or X.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <form className="space-y-3" onSubmit={createPairing}>
            <label className="block space-y-1.5" htmlFor="publisher-device-name">
              <span className="text-sm font-medium">Computer name</span>
              <Input
                id="publisher-device-name"
                name="deviceName"
                value={deviceName}
                maxLength={80}
                autoComplete="off"
                onChange={(event) => setDeviceName(event.currentTarget.value)}
                placeholder="My MacBook"
                disabled={pairing.status === 'creating'}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                disabled={pairing.status === 'creating' || deviceName.trim().length === 0}
              >
                {pairing.status === 'creating' ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <KeyRound aria-hidden="true" className="size-4" />
                )}
                {pairing.status === 'creating'
                  ? 'Creating code…'
                  : pairingValue
                    ? 'Create new code'
                    : 'Create pairing code'}
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Codes expire after 10 minutes and are shown only in this browser session.
              </p>
            </div>
        </form>

        <section
            className="space-y-3 border-t border-dotted border-border/80 pt-5"
            aria-labelledby="publisher-devices-title"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 id="publisher-devices-title" className="text-sm font-semibold">
                  Publishing computers
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Revoke a computer to disable its token or unused pairing code immediately.
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
                Refresh
              </Button>
            </div>

            {devices.status === 'loading' ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                Loading publishing computers…
              </p>
            ) : null}

            {devices.status === 'error' ? (
              <p className="text-sm text-destructive" role="alert">
                Publishing computers could not be loaded. Check the connection and try again.
              </p>
            ) : null}

            {devices.status === 'ready' && devices.devices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No publishing computers yet.</p>
            ) : null}

            {devices.status === 'ready' && devices.devices.length > 0 ? (
              <ul className="space-y-2">
                {devices.devices.map((device) => {
                  const isRevoking = revokingDeviceId === device.id;
                  return (
                    <li
                      key={device.id}
                      aria-label={`Publishing device ${device.name}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/75 bg-muted/20 p-3"
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
                          >
                            {device.status === 'active'
                              ? 'Active'
                              : device.status === 'pending'
                                ? 'Pending'
                                : 'Revoked'}
                          </Badge>
                          <span>Protocol v{device.protocolVersion}</span>
                          <span aria-hidden="true">·</span>
                          {device.lastSeenAt ? (
                            <span>
                              Last seen{' '}
                              <time dateTime={device.lastSeenAt}>
                                {new Date(device.lastSeenAt).toLocaleString([], {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                })}
                              </time>
                            </span>
                          ) : (
                            <span>Never seen</span>
                          )}
                        </div>
                      </div>
                      {device.status !== 'revoked' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={`Revoke ${device.name}`}
                          disabled={revokingDeviceId !== null}
                          onClick={() => void revokeDevice(device)}
                        >
                          {isRevoking ? (
                            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                          ) : (
                            <ShieldOff aria-hidden="true" className="size-4" />
                          )}
                          {isRevoking ? 'Revoking…' : 'Revoke'}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {deviceError ? (
              <p className="text-sm text-destructive" role="alert">{deviceError}</p>
            ) : null}
        </section>

        {pairing.status === 'error' ? (
          <p className="text-sm text-destructive" role="alert">
            A pairing code could not be created. Confirm your account connection and try again.
          </p>
        ) : null}

        {pairingValue ? (
          <div className="space-y-5 border-t border-dotted border-border/80 pt-5">
            <section className="space-y-2" aria-labelledby="publisher-pairing-code-title">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 id="publisher-pairing-code-title" className="text-sm font-semibold">
                    One-time pairing code
                  </h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Valid until{' '}
                    <time dateTime={pairingValue.expiresAt}>
                      {new Date(pairingValue.expiresAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copyText('code', pairingValue.pairingCode)}
                >
                  {copyState === 'code' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  {copyState === 'code' ? 'Copied code' : 'Copy code'}
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
                    Companion commands
                  </h4>
                  <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                    Run the pair command, paste the code into its hidden prompt, then start the companion. The code is kept out of shell history.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copyText('commands', companionCommands)}
                >
                  {copyState === 'commands' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  {copyState === 'commands' ? 'Copied commands' : 'Copy commands'}
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-lg border border-border/80 bg-muted/35 p-3 font-mono text-xs leading-6 text-foreground">
                <code>{companionCommands}</code>
              </pre>
            </section>

            <p className="text-xs leading-relaxed text-muted-foreground">
              The companion stores its device token in your operating-system keyring. Your Binance and X sessions remain in your local Chrome profile.
            </p>
          </div>
        ) : null}

        {copyState === 'error' ? (
          <p className="text-xs text-destructive" role="alert">
            Clipboard access is unavailable. Select and copy the value manually.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
