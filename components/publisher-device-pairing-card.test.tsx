// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PublisherDevicePairingCard } from './publisher-device-pairing-card';

const fetchMock = vi.fn();
const writeText = vi.fn(async (_value: string) => undefined);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockPublisherApi({
  devices = [],
  devicesStatus = 200,
  pairingBody,
  pairingStatus = 201,
  revokeBody,
  revokeStatus = 200,
}: {
  devices?: unknown[];
  devicesStatus?: number;
  pairingBody?: unknown;
  pairingStatus?: number;
  revokeBody?: unknown;
  revokeStatus?: number;
} = {}) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method?.toUpperCase() ?? 'GET';

    // Compatibility response for the current implementation. The new account-
    // scoped component must never request it; focused assertions below enforce that.
    if (url === '/api/workspace') {
      return jsonResponse({ hasWorkspace: true });
    }
    if (url === '/api/publisher/devices' && method === 'GET') {
      return jsonResponse({ devices }, devicesStatus);
    }
    if (url === '/api/publisher/devices/pairing' && method === 'POST') {
      return jsonResponse(pairingBody, pairingStatus);
    }
    if (url.startsWith('/api/publisher/devices/') && method === 'DELETE') {
      return jsonResponse(revokeBody, revokeStatus);
    }
    return jsonResponse({ error: 'Unexpected publisher API request.' }, 500);
  });
}

function mockReplacementFlow(replacementResponse: Promise<Response>) {
  let pairingRequestCount = 0;
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method?.toUpperCase() ?? 'GET';

    if (url === '/api/publisher/devices' && method === 'GET') {
      return Promise.resolve(jsonResponse({ devices: [] }));
    }
    if (url === '/api/publisher/devices/pairing' && method === 'POST') {
      pairingRequestCount += 1;
      if (pairingRequestCount === 1) {
        return Promise.resolve(jsonResponse({
          deviceId: 'device_old',
          pairingCode: 'old_pairing_code_value_12345678901234567890',
          tokenPrefix: 'old_pair',
          expiresAt: '2026-07-22T03:10:00.000Z',
        }, 201));
      }
      return replacementResponse;
    }
    return Promise.resolve(jsonResponse({ error: 'Unexpected publisher API request.' }, 500));
  });
  return () => pairingRequestCount;
}

describe('PublisherDevicePairingCard', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    writeText.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('loads account publishing devices directly without fetching a client-visible workspace', async () => {
    mockPublisherApi();

    render(<PublisherDevicePairingCard />);

    await screen.findByLabelText('Computer name');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/publisher/devices', expect.objectContaining({
      cache: 'no-store',
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
    }));
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/workspace')).toBe(false);
    expect(screen.getByText(/pair this account with the companion/i)).toBeTruthy();
  });

  it('keeps the last device list visible while a manual refresh is pending', async () => {
    let resolveRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        devices: [{
          id: 'device_active',
          name: 'Studio Mac',
          status: 'active',
          protocolVersion: 1,
          lastSeenAt: null,
        }],
      }))
      .mockImplementationOnce(() => refreshResponse);

    render(<PublisherDevicePairingCard />);

    await screen.findByRole('listitem', { name: 'Publishing device Studio Mac' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(screen.getByRole('listitem', {
      name: 'Publishing device Studio Mac',
    })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolveRefresh(jsonResponse({
      devices: [{
        id: 'device_active',
        name: 'Studio Mac',
        status: 'active',
        protocolVersion: 2,
        lastSeenAt: null,
      }],
    }));
    await screen.findByText('Protocol v2');
  });

  it('does not let a stale device refresh remove a newly created pairing', async () => {
    let resolveRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    let devicesRequestCount = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method?.toUpperCase() ?? 'GET';
      if (url === '/api/publisher/devices' && method === 'GET') {
        devicesRequestCount += 1;
        return devicesRequestCount === 1
          ? Promise.resolve(jsonResponse({ devices: [] }))
          : refreshResponse;
      }
      if (url === '/api/publisher/devices/pairing' && method === 'POST') {
        return Promise.resolve(jsonResponse({
          deviceId: 'device_new',
          pairingCode: 'new_pairing_code_value_12345678901234567890',
          tokenPrefix: 'new_pair',
          expiresAt: '2026-07-22T03:10:00.000Z',
        }, 201));
      }
      return Promise.resolve(jsonResponse({ error: 'Unexpected publisher API request.' }, 500));
    });

    render(<PublisherDevicePairingCard />);
    await screen.findByText('No publishing computers yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));

    await screen.findByRole('listitem', {
      name: 'Publishing device My publishing computer',
    });

    await act(async () => {
      resolveRefresh(jsonResponse({ devices: [] }));
      await refreshResponse;
    });

    expect(screen.getByRole('listitem', {
      name: 'Publishing device My publishing computer',
    })).toBeTruthy();
    expect(screen.queryByText('No publishing computers yet.')).toBeNull();
  });

  it('does not let a stale device refresh undo a successful revocation', async () => {
    const activeDevice = {
      id: 'device_active',
      name: 'Studio Mac',
      status: 'active',
      protocolVersion: 2,
      lastSeenAt: null,
    };
    let resolveRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    let devicesRequestCount = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method?.toUpperCase() ?? 'GET';
      if (url === '/api/publisher/devices' && method === 'GET') {
        devicesRequestCount += 1;
        return devicesRequestCount === 1
          ? Promise.resolve(jsonResponse({ devices: [activeDevice] }))
          : refreshResponse;
      }
      if (url === '/api/publisher/devices/device_active' && method === 'DELETE') {
        return Promise.resolve(jsonResponse({ revoked: true }));
      }
      return Promise.resolve(jsonResponse({ error: 'Unexpected publisher API request.' }, 500));
    });

    render(<PublisherDevicePairingCard />);
    const row = await screen.findByRole('listitem', {
      name: 'Publishing device Studio Mac',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke Studio Mac' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Revoke',
    }));

    await waitFor(() => expect(within(row).getByText('Revoked')).toBeTruthy());

    await act(async () => {
      resolveRefresh(jsonResponse({ devices: [activeDevice] }));
      await refreshResponse;
    });

    expect(within(row).getByText('Revoked')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Revoke Studio Mac' })).toBeNull();
  });

  it('sends only the computer name when creating an account-scoped pairing code', async () => {
    mockPublisherApi({
      pairingBody: {
        deviceId: 'device_1',
        pairingCode: 'pairing_code_value_12345678901234567890',
        tokenPrefix: 'pairing_',
        expiresAt: '2026-07-22T03:10:00.000Z',
      },
    });

    const { container } = render(<PublisherDevicePairingCard />);

    const nameInput = await screen.findByLabelText('Computer name');
    fireEvent.change(nameInput, { target: { value: 'Studio Mac' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));

    expect(await screen.findByText('pairing_code_value_12345678901234567890')).toBeTruthy();
    const pairingCall = fetchMock.mock.calls.find(([url]) => (
      url === '/api/publisher/devices/pairing'
    ));
    const request = pairingCall?.[1] as RequestInit | undefined;
    expect(pairingCall?.[0]).toBe('/api/publisher/devices/pairing');
    expect(request).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
    });
    expect(JSON.parse(String(request?.body))).toEqual({ name: 'Studio Mac' });
    expect(screen.getByText(/bun run src\/main\.ts pair --api/).textContent)
      .toContain(window.location.origin);
    expect(screen.getByText(/paste the code into its hidden prompt/i)).toBeTruthy();
    expect(container.textContent).not.toMatch(/workspace/i);
  });

  it('copies the code separately from commands so it never enters shell history', async () => {
    mockPublisherApi({
      pairingBody: {
        deviceId: 'device_1',
        pairingCode: 'pairing_code_value_12345678901234567890',
        tokenPrefix: 'pairing_',
        expiresAt: '2026-07-22T03:10:00.000Z',
      },
    });

    const onUncopiedPairingChange = vi.fn();
    render(
      <PublisherDevicePairingCard
        onUncopiedPairingChange={onUncopiedPairingChange}
      />,
    );
    await screen.findByLabelText('Computer name');
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));
    await screen.findByText('pairing_code_value_12345678901234567890');
    expect(onUncopiedPairingChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      'pairing_code_value_12345678901234567890',
    ));
    expect(onUncopiedPairingChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole('button', { name: 'Copy commands' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(
      expect.stringContaining('bun run src/main.ts pair --api'),
    ));
    const commands = String(writeText.mock.calls.at(-1)?.[0]);
    expect(commands).not.toContain('pairing_code_value_12345678901234567890');
    expect(commands).toContain('bun run src/main.ts run');
  });

  it('confirms before replacing a pairing code that has not been copied', async () => {
    mockPublisherApi({
      pairingBody: {
        deviceId: 'device_1',
        pairingCode: 'pairing_code_value_12345678901234567890',
        tokenPrefix: 'pairing_',
        expiresAt: '2026-07-22T03:10:00.000Z',
      },
    });

    render(<PublisherDevicePairingCard />);
    await screen.findByLabelText('Computer name');
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));
    await screen.findByText('pairing_code_value_12345678901234567890');

    fireEvent.click(screen.getByRole('button', { name: 'Create new code' }));

    const pairingRequests = () => fetchMock.mock.calls.filter(([url]) => (
      url === '/api/publisher/devices/pairing'
    ));
    expect(pairingRequests()).toHaveLength(1);
    const confirmation = screen.getByRole('alertdialog');
    expect(confirmation.textContent).toMatch(/replace|create a new/i);
    expect(confirmation.textContent).toMatch(/not (?:been )?copied|copy/i);
    expect(screen.getByText('pairing_code_value_12345678901234567890')).toBeTruthy();

    fireEvent.click(within(confirmation).getByRole('button', { name: /replace|create new/i }));
    await waitFor(() => expect(pairingRequests()).toHaveLength(2));
  });

  it('keeps the uncopied code protected through a failed replacement and retries in the confirmation', async () => {
    let pairingRequestCount = 0;
    let resolveReplacement!: (response: Response) => void;
    const pendingReplacement = new Promise<Response>((resolve) => {
      resolveReplacement = resolve;
    });

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method?.toUpperCase() ?? 'GET';

      if (url === '/api/publisher/devices' && method === 'GET') {
        return Promise.resolve(jsonResponse({ devices: [] }));
      }
      if (url === '/api/publisher/devices/pairing' && method === 'POST') {
        pairingRequestCount += 1;
        if (pairingRequestCount === 1) {
          return Promise.resolve(jsonResponse({
            deviceId: 'device_old',
            pairingCode: 'old_pairing_code_value_12345678901234567890',
            tokenPrefix: 'old_pair',
            expiresAt: '2026-07-22T03:10:00.000Z',
          }, 201));
        }
        if (pairingRequestCount === 2) return pendingReplacement;
        return Promise.resolve(jsonResponse({
          deviceId: 'device_new',
          pairingCode: 'new_pairing_code_value_12345678901234567890',
          tokenPrefix: 'new_pair',
          expiresAt: '2026-07-22T03:20:00.000Z',
        }, 201));
      }
      return Promise.resolve(jsonResponse({ error: 'Unexpected publisher API request.' }, 500));
    });

    const onUncopiedPairingChange = vi.fn();
    render(
      <PublisherDevicePairingCard
        onUncopiedPairingChange={onUncopiedPairingChange}
      />,
    );
    await screen.findByLabelText('Computer name');
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));
    await screen.findByText('old_pairing_code_value_12345678901234567890');

    fireEvent.click(screen.getByRole('button', { name: 'Create new code' }));
    let confirmation = screen.getByRole('alertdialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: /replace code/i }));

    expect(screen.getByText('old_pairing_code_value_12345678901234567890')).toBeTruthy();
    expect(onUncopiedPairingChange.mock.calls).not.toContainEqual([false]);

    resolveReplacement(jsonResponse({
      deviceId: 'device_invalid',
      pairingCode: 42,
      tokenPrefix: 'invalid_',
      expiresAt: '2026-07-22T03:15:00.000Z',
    }, 201));

    await waitFor(() => {
      confirmation = screen.getByRole('alertdialog');
      expect(within(confirmation).getByRole('alert').textContent).toMatch(
        /current code is still available.*try again/i,
      );
    });
    expect(screen.getByText('old_pairing_code_value_12345678901234567890')).toBeTruthy();
    expect(onUncopiedPairingChange.mock.calls).not.toContainEqual([false]);

    fireEvent.click(within(confirmation).getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('new_pairing_code_value_12345678901234567890')).toBeTruthy();
    expect(screen.queryByText('old_pairing_code_value_12345678901234567890')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onUncopiedPairingChange.mock.calls).not.toContainEqual([false]);
  });

  it('keeps a copied code unguarded after copying commands and a failed direct replacement', async () => {
    let resolveReplacement!: (response: Response) => void;
    const replacementResponse = new Promise<Response>((resolve) => {
      resolveReplacement = resolve;
    });
    const pairingRequestCount = mockReplacementFlow(replacementResponse);
    const onUncopiedPairingChange = vi.fn();

    render(
      <PublisherDevicePairingCard
        onUncopiedPairingChange={onUncopiedPairingChange}
      />,
    );
    await screen.findByLabelText('Computer name');
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));
    await screen.findByText('old_pairing_code_value_12345678901234567890');

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(onUncopiedPairingChange).toHaveBeenLastCalledWith(false));
    fireEvent.click(screen.getByRole('button', { name: 'Copy commands' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(
      expect.stringContaining('bun run src/main.ts pair --api'),
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Create new code' }));

    await waitFor(() => expect(pairingRequestCount()).toBe(2));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    resolveReplacement(jsonResponse({ error: 'sensitive database detail' }, 500));

    await waitFor(() => expect(onUncopiedPairingChange).toHaveBeenLastCalledWith(false));
    const retryDialog = screen.getByRole('alertdialog');
    expect(within(retryDialog).getByRole('alert').textContent).toMatch(
      /current code is still available.*try again/i,
    );
    expect(within(retryDialog).queryByText(/has not been copied/i)).toBeNull();
    expect(screen.getByText('old_pairing_code_value_12345678901234567890')).toBeTruthy();
  });

  it('keeps a copied code unguarded after a later clipboard error', async () => {
    let resolveReplacement!: (response: Response) => void;
    const replacementResponse = new Promise<Response>((resolve) => {
      resolveReplacement = resolve;
    });
    const pairingRequestCount = mockReplacementFlow(replacementResponse);
    const onUncopiedPairingChange = vi.fn();

    render(
      <PublisherDevicePairingCard
        onUncopiedPairingChange={onUncopiedPairingChange}
      />,
    );
    await screen.findByLabelText('Computer name');
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));
    await screen.findByText('old_pairing_code_value_12345678901234567890');

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(onUncopiedPairingChange).toHaveBeenLastCalledWith(false));
    writeText.mockRejectedValueOnce(new Error('Clipboard denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy commands' }));
    await screen.findByText('Clipboard access is unavailable. Select and copy the value manually.');

    fireEvent.click(screen.getByRole('button', { name: 'Create new code' }));

    await waitFor(() => expect(pairingRequestCount()).toBe(2));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    resolveReplacement(jsonResponse({ error: 'sensitive database detail' }, 500));
    await waitFor(() => expect(onUncopiedPairingChange).toHaveBeenLastCalledWith(false));
  });

  it('does not let an old code copy clear protection while replacement is pending', async () => {
    let resolveReplacement!: (response: Response) => void;
    const replacementResponse = new Promise<Response>((resolve) => {
      resolveReplacement = resolve;
    });
    mockReplacementFlow(replacementResponse);
    const onUncopiedPairingChange = vi.fn();

    render(
      <PublisherDevicePairingCard
        onUncopiedPairingChange={onUncopiedPairingChange}
      />,
    );
    await screen.findByLabelText('Computer name');
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));
    await screen.findByText('old_pairing_code_value_12345678901234567890');
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(onUncopiedPairingChange).toHaveBeenLastCalledWith(false));

    let resolveOldCopy!: (value: undefined) => void;
    const oldCopy = new Promise<undefined>((resolve) => {
      resolveOldCopy = resolve;
    });
    writeText.mockImplementationOnce(() => oldCopy);
    fireEvent.click(screen.getByRole('button', { name: 'Copied code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create new code' }));
    await waitFor(() => expect(onUncopiedPairingChange).toHaveBeenLastCalledWith(true));

    await act(async () => {
      resolveOldCopy(undefined);
      await oldCopy;
    });

    expect(onUncopiedPairingChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('button', { name: 'Copied code' }).hasAttribute('disabled')).toBe(true);

    resolveReplacement(jsonResponse({ error: 'sensitive database detail' }, 500));
    await waitFor(() => expect(onUncopiedPairingChange).toHaveBeenLastCalledWith(false));
  });

  it('ignores an old code copy that resolves after a valid replacement is displayed', async () => {
    let resolveReplacement!: (response: Response) => void;
    const replacementResponse = new Promise<Response>((resolve) => {
      resolveReplacement = resolve;
    });
    mockReplacementFlow(replacementResponse);
    const onUncopiedPairingChange = vi.fn();

    render(
      <PublisherDevicePairingCard
        onUncopiedPairingChange={onUncopiedPairingChange}
      />,
    );
    await screen.findByLabelText('Computer name');
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));
    await screen.findByText('old_pairing_code_value_12345678901234567890');
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(onUncopiedPairingChange).toHaveBeenLastCalledWith(false));

    let resolveOldCopy!: (value: undefined) => void;
    const oldCopy = new Promise<undefined>((resolve) => {
      resolveOldCopy = resolve;
    });
    writeText.mockImplementationOnce(() => oldCopy);
    fireEvent.click(screen.getByRole('button', { name: 'Copied code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create new code' }));
    resolveReplacement(jsonResponse({
      deviceId: 'device_new',
      pairingCode: 'new_pairing_code_value_12345678901234567890',
      tokenPrefix: 'new_pair',
      expiresAt: '2026-07-22T03:20:00.000Z',
    }, 201));

    await screen.findByText('new_pairing_code_value_12345678901234567890');
    expect(onUncopiedPairingChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy();

    await act(async () => {
      resolveOldCopy(undefined);
      await oldCopy;
    });

    expect(onUncopiedPairingChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy();
  });

  it('keeps a failed pairing request retryable without exposing server details', async () => {
    mockPublisherApi({
      pairingBody: {
        error: 'sensitive database detail',
        code: 'DEVICE_PAIRING_CREATE_FAILED',
      },
      pairingStatus: 500,
    });

    render(<PublisherDevicePairingCard />);
    await screen.findByLabelText('Computer name');
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'A pairing code could not be created. Confirm your account connection and try again.',
    );
    expect(screen.queryByText(/sensitive database detail/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Create pairing code' }).hasAttribute('disabled'))
      .toBe(false);
  });

  it('shows device status, last seen, name, and protocol and revokes active or pending devices', async () => {
    mockPublisherApi({
      devices: [
          {
            id: 'device_active',
            name: 'Studio Mac',
            status: 'active',
            protocolVersion: 1,
            lastSeenAt: '2026-07-22T03:00:00.000Z',
          },
          {
            id: 'device_pending',
            name: 'Travel Mac',
            status: 'pending',
            protocolVersion: 2,
            lastSeenAt: null,
          },
          {
            id: 'device_revoked',
            name: 'Old Mac',
            status: 'revoked',
            protocolVersion: 1,
            lastSeenAt: '2026-07-20T03:00:00.000Z',
          },
      ],
      revokeBody: { revoked: true },
    });

    render(<PublisherDevicePairingCard />);

    const activeDevice = await screen.findByRole('listitem', {
      name: 'Publishing device Studio Mac',
    });
    expect(within(activeDevice).getByText('Active')).toBeTruthy();
    expect(within(activeDevice).getByText('Protocol v1')).toBeTruthy();
    expect(activeDevice.querySelector('time')?.getAttribute('dateTime'))
      .toBe('2026-07-22T03:00:00.000Z');

    const pendingDevice = screen.getByRole('listitem', {
      name: 'Publishing device Travel Mac',
    });
    expect(within(pendingDevice).getByText('Pending')).toBeTruthy();
    expect(within(pendingDevice).getByText('Protocol v2')).toBeTruthy();
    expect(within(pendingDevice).getByText('Never seen')).toBeTruthy();
    expect(within(pendingDevice).getByRole('button', { name: 'Revoke Travel Mac' })).toBeTruthy();

    const revokedDevice = screen.getByRole('listitem', {
      name: 'Publishing device Old Mac',
    });
    expect(within(revokedDevice).getByText('Revoked').className).toContain('rounded-full');
    expect(within(revokedDevice).queryByRole('button', { name: 'Revoke Old Mac' })).toBeNull();

    fireEvent.click(within(activeDevice).getByRole('button', { name: 'Revoke Studio Mac' }));

    expect(fetchMock.mock.calls.some(([url, init]) => (
      url === '/api/publisher/devices/device_active'
      && (init as RequestInit | undefined)?.method === 'DELETE'
    ))).toBe(false);
    const confirmation = screen.getByRole('alertdialog');
    expect(confirmation.textContent).toMatch(/revoke/i);
    expect(confirmation.textContent).toContain('Studio Mac');
    fireEvent.click(within(confirmation).getByRole('button', { name: /revoke/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/publisher/devices/device_active',
      expect.objectContaining({ method: 'DELETE', credentials: 'same-origin' }),
    ));
    await waitFor(() => expect(within(activeDevice).getByText('Revoked')).toBeTruthy());
    expect(within(activeDevice).queryByRole('button', { name: 'Revoke Studio Mac' })).toBeNull();
  });

  it('uses a modal revoke confirmation with cancel focus, Escape dismissal, and focus restoration', async () => {
    mockPublisherApi({
      devices: [{
        id: 'device_active',
        name: 'Studio Mac',
        status: 'active',
        protocolVersion: 1,
        lastSeenAt: null,
      }],
      revokeBody: { revoked: true },
    });

    render(<PublisherDevicePairingCard />);
    const activeDevice = await screen.findByRole('listitem', {
      name: 'Publishing device Studio Mac',
    });
    const revokeTrigger = within(activeDevice).getByRole('button', {
      name: 'Revoke Studio Mac',
    });
    revokeTrigger.focus();
    fireEvent.click(revokeTrigger);

    const confirmation = screen.getByRole('alertdialog');
    const cancel = within(confirmation).getByRole('button', { name: 'Cancel' });
    expect(activeDevice.contains(confirmation)).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(cancel));

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(revokeTrigger);
    expect(fetchMock.mock.calls.some(([url, init]) => (
      url === '/api/publisher/devices/device_active'
      && (init as RequestInit | undefined)?.method === 'DELETE'
    ))).toBe(false);
  });

  it('moves focus to the stable device row after a successful revoke removes its trigger', async () => {
    mockPublisherApi({
      devices: [{
        id: 'device_active',
        name: 'Studio Mac',
        status: 'active',
        protocolVersion: 1,
        lastSeenAt: null,
      }],
      revokeBody: { revoked: true },
    });

    render(<PublisherDevicePairingCard />);
    const activeDevice = await screen.findByRole('listitem', {
      name: 'Publishing device Studio Mac',
    });
    const revokeTrigger = within(activeDevice).getByRole('button', {
      name: 'Revoke Studio Mac',
    });
    revokeTrigger.focus();
    fireEvent.click(revokeTrigger);

    const confirmation = screen.getByRole('alertdialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(within(activeDevice).getByText('Revoked')).toBeTruthy();
    expect(activeDevice.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(activeDevice);
    expect(screen.getByRole('status').textContent).toBe('Studio Mac was revoked.');
  });

  it('keeps a failed device revocation retryable without exposing server details', async () => {
    mockPublisherApi({
      devices: [{
          id: 'device_active',
          name: 'Studio Mac',
          status: 'active',
          protocolVersion: 1,
          lastSeenAt: null,
      }],
      revokeBody: { error: 'sensitive database detail' },
      revokeStatus: 500,
    });

    render(<PublisherDevicePairingCard />);
    const activeDevice = await screen.findByRole('listitem', {
      name: 'Publishing device Studio Mac',
    });
    fireEvent.click(within(activeDevice).getByRole('button', { name: 'Revoke Studio Mac' }));

    const confirmation = screen.getByRole('alertdialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: /revoke/i }));

    await waitFor(() => expect(within(screen.getByRole('alertdialog')).getByRole('alert').textContent).toBe(
      'Studio Mac could not be revoked. Check the connection and try again.',
    ));
    expect(screen.queryByText(/sensitive database detail/i)).toBeNull();
    expect(within(activeDevice).getByText('Active')).toBeTruthy();
    expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Revoke' })
      .hasAttribute('disabled')).toBe(false);
  });
});
