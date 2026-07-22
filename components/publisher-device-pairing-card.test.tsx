// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('loads the active workspace and creates a named one-time pairing code', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        hasWorkspace: true,
        workspaceId: 'workspace_1',
      }))
      .mockResolvedValueOnce(jsonResponse({ devices: [] }))
      .mockResolvedValueOnce(jsonResponse({
        deviceId: 'device_1',
        pairingCode: 'pairing_code_value_12345678901234567890',
        tokenPrefix: 'pairing_',
        expiresAt: '2026-07-22T03:10:00.000Z',
      }, 201));

    render(<PublisherDevicePairingCard />);

    const nameInput = await screen.findByLabelText('Computer name');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/workspace', expect.objectContaining({
      cache: 'no-store',
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
    }));

    fireEvent.change(nameInput, { target: { value: 'Studio Mac' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));

    expect(await screen.findByText('pairing_code_value_12345678901234567890')).toBeTruthy();
    const request = fetchMock.mock.calls[2]?.[1] as RequestInit | undefined;
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/publisher/devices/pairing');
    expect(request).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      workspaceId: 'workspace_1',
      name: 'Studio Mac',
    });
    expect(screen.getByText(/bun run src\/main\.ts pair --api/).textContent)
      .toContain(window.location.origin);
    expect(screen.getByText(/paste the code into its hidden prompt/i)).toBeTruthy();
  });

  it('copies the code separately from commands so it never enters shell history', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ hasWorkspace: true, workspaceId: 'workspace_1' }))
      .mockResolvedValueOnce(jsonResponse({ devices: [] }))
      .mockResolvedValueOnce(jsonResponse({
        deviceId: 'device_1',
        pairingCode: 'pairing_code_value_12345678901234567890',
        tokenPrefix: 'pairing_',
        expiresAt: '2026-07-22T03:10:00.000Z',
      }, 201));

    render(<PublisherDevicePairingCard />);
    await screen.findByLabelText('Computer name');
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));
    await screen.findByText('pairing_code_value_12345678901234567890');

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      'pairing_code_value_12345678901234567890',
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Copy commands' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(
      expect.stringContaining('bun run src/main.ts pair --api'),
    ));
    const commands = String(writeText.mock.calls.at(-1)?.[0]);
    expect(commands).not.toContain('pairing_code_value_12345678901234567890');
    expect(commands).toContain('bun run src/main.ts run');
  });

  it('does not offer pairing until the account has a workspace', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      hasWorkspace: false,
      workspaceId: null,
    }));

    render(<PublisherDevicePairingCard />);

    expect(await screen.findByText(/create or recover a workspace before pairing/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to workspace' }).getAttribute('href'))
      .toBe('/workspace');
    expect(screen.queryByRole('button', { name: 'Create pairing code' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed pairing request retryable without exposing server details', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ hasWorkspace: true, workspaceId: 'workspace_1' }))
      .mockResolvedValueOnce(jsonResponse({ devices: [] }))
      .mockResolvedValueOnce(jsonResponse({
        error: 'sensitive database detail',
        code: 'DEVICE_PAIRING_CREATE_FAILED',
      }, 500));

    render(<PublisherDevicePairingCard />);
    await screen.findByLabelText('Computer name');
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'A pairing code could not be created. Confirm the workspace and try again.',
    );
    expect(screen.queryByText(/sensitive database detail/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Create pairing code' }).hasAttribute('disabled'))
      .toBe(false);
  });

  it('shows device status, last seen, name, and protocol and revokes active or pending devices', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ hasWorkspace: true, workspaceId: 'workspace_1' }))
      .mockResolvedValueOnce(jsonResponse({
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
      }))
      .mockResolvedValueOnce(jsonResponse({ revoked: true }));

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
    expect(within(revokedDevice).getByText('Revoked')).toBeTruthy();
    expect(within(revokedDevice).queryByRole('button', { name: 'Revoke Old Mac' })).toBeNull();

    fireEvent.click(within(activeDevice).getByRole('button', { name: 'Revoke Studio Mac' }));

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/publisher/devices/device_active',
      expect.objectContaining({ method: 'DELETE', credentials: 'same-origin' }),
    ));
    await waitFor(() => expect(within(activeDevice).getByText('Revoked')).toBeTruthy());
    expect(within(activeDevice).queryByRole('button', { name: 'Revoke Studio Mac' })).toBeNull();
  });

  it('keeps a failed device revocation retryable without exposing server details', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ hasWorkspace: true, workspaceId: 'workspace_1' }))
      .mockResolvedValueOnce(jsonResponse({
        devices: [{
          id: 'device_active',
          name: 'Studio Mac',
          status: 'active',
          protocolVersion: 1,
          lastSeenAt: null,
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({ error: 'sensitive database detail' }, 500));

    render(<PublisherDevicePairingCard />);
    const activeDevice = await screen.findByRole('listitem', {
      name: 'Publishing device Studio Mac',
    });
    fireEvent.click(within(activeDevice).getByRole('button', { name: 'Revoke Studio Mac' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Studio Mac could not be revoked. Check the connection and try again.',
    );
    expect(screen.queryByText(/sensitive database detail/i)).toBeNull();
    expect(within(activeDevice).getByText('Active')).toBeTruthy();
    expect(within(activeDevice).getByRole('button', { name: 'Revoke Studio Mac' })
      .hasAttribute('disabled')).toBe(false);
  });
});
