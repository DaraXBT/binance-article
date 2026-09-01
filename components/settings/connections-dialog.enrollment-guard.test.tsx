// @vitest-environment jsdom

import React, { type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

import { ConnectionsDialog } from './connections-dialog';

vi.mock('@/components/workspace-ai-credential-card', () => ({
  WorkspaceAiCredentialCard: () => <div>Your Gemini key</div>,
}));

vi.mock('@/components/publisher-device-pairing-card', () => ({
  PublisherDevicePairingCard: () => <div>Browser publisher</div>,
}));

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('ConnectionsDialog enrollment request guard', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps Settings mounted on close and Browser Back while enrollment creation is unresolved', async () => {
    const createRequest = deferred<Response>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        activeCode: null,
        capacity: { activeUsers: 1, legacyInvitations: 0, reservedClaims: 0, limit: 10 },
      }))
      .mockResolvedValueOnce(jsonResponse({ people: [] }))
      .mockImplementationOnce(() => createRequest.promise)
      .mockResolvedValueOnce(jsonResponse({
        activeCode: {
          version: 1,
          codePrefix: 'ABCDEFGH',
          status: 'active',
          createdAt: '2026-08-16T00:00:00.000Z',
        },
        capacity: { activeUsers: 1, legacyInvitations: 0, reservedClaims: 0, limit: 10 },
      }))
      .mockResolvedValueOnce(jsonResponse({ people: [] }));
    const onOpenChange = vi.fn();
    const openProps = {
      open: true,
      onOpenChange,
      canManageAi: true,
      canManageAccess: true,
    } satisfies ComponentProps<typeof ConnectionsDialog>;
    const { rerender } = render(<ConnectionsDialog {...openProps} />);

    fireEvent.click(screen.getByRole('tab', { name: 'People & access' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create code' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getAllByRole('button', { name: 'Close account settings' })[0]);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Copy your one-time value');

    rerender(<ConnectionsDialog {...openProps} open={false} />);
    expect(screen.getByRole('dialog', { name: 'Account settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review code' })).toBeTruthy();

    await act(async () => {
      createRequest.resolve(jsonResponse({
        code: 'JOIN-ABCDE-FGHJK-MNPQR-STUVW',
        codePrefix: 'ABCDEFGH',
        version: 1,
      }, 201));
    });

    expect(await screen.findByText('JOIN-ABCDE-FGHJK-MNPQR-STUVW')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Account settings' })).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
