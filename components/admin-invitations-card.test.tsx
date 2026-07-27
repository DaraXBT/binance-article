// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminInvitationsCard } from './admin-invitations-card';

const fetchMock = vi.fn();
const writeText = vi.fn(async () => undefined);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminInvitationsCard', () => {
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

  it('marks a one-time join URL as sensitive until it has been copied', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ invitations: [] }))
      .mockResolvedValueOnce(jsonResponse({
        invitation: {
          joinUrl: 'https://example.test/join?token=one-time-token',
          expiresAt: '2026-07-28T00:00:00.000Z',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ invitations: [] }));
    const onUncopiedInvitationChange = vi.fn();
    render(
      <AdminInvitationsCard
        onUncopiedInvitationChange={onUncopiedInvitationChange}
      />,
    );
    await screen.findByText('No invitations yet.');

    fireEvent.change(screen.getByRole('textbox', { name: 'Invitation email' }), {
      target: { value: 'teammate@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));

    await screen.findByText(/Invitation for teammate@example.com/);
    expect(onUncopiedInvitationChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      'https://example.test/join?token=one-time-token',
    ));
    expect(onUncopiedInvitationChange).toHaveBeenLastCalledWith(false);
  });
});
