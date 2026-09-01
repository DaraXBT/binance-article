// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from './language-provider';
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
      <LanguageProvider initialLanguage="en">
        <AdminInvitationsCard
          onUncopiedInvitationChange={onUncopiedInvitationChange}
        />
      </LanguageProvider>,
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

  it('uses the selected language for invitation controls and safe API recovery copy', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ invitations: [] }))
      .mockResolvedValueOnce(jsonResponse({
        code: 'INVITATION_ALREADY_PENDING',
        error: 'An active invitation already exists for this email.',
      }, 409));

    render(
      <LanguageProvider initialLanguage="km">
        <AdminInvitationsCard />
      </LanguageProvider>,
    );

    await screen.findByText('មិនទាន់មានការអញ្ជើញទេ។');
    fireEvent.change(screen.getByRole('textbox', { name: 'អ៊ីមែលសម្រាប់ការអញ្ជើញ' }), {
      target: { value: 'teammate@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'បង្កើតការអញ្ជើញ' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'មានការអញ្ជើញសកម្មស្រាប់សម្រាប់អ៊ីមែលនេះ។',
    );
  });
});
