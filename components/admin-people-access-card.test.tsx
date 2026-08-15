// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminPeopleAccessCard } from './admin-people-access-card';

const fetchMock = vi.fn();
const writeText = vi.fn(async () => undefined);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const overview = {
  activeCode: null,
  capacity: { activeUsers: 1, legacyInvitations: 0, reservedClaims: 0, limit: 10 },
};

const people = {
  people: [{
    id: 'owner_1',
    name: 'Owner',
    email: 'owner@example.com',
    role: 'owner',
    status: 'active',
    isCurrentUser: true,
    createdAt: '2026-08-01T00:00:00.000Z',
  }, {
    id: 'user_1',
    name: 'New User',
    email: 'new@example.com',
    role: 'user',
    status: 'active',
    createdAt: '2026-08-02T00:00:00.000Z',
  }],
};

describe('AdminPeopleAccessCard', () => {
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

  it('includes live legacy invitation seats in the displayed beta capacity', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        activeCode: null,
        capacity: { activeUsers: 3, legacyInvitations: 2, reservedClaims: 1, limit: 10 },
      }))
      .mockResolvedValueOnce(jsonResponse(people));

    render(<AdminPeopleAccessCard />);

    const invited = await screen.findByText('Invited');
    expect(invited.parentElement?.textContent).toContain('2');
    expect(screen.getByText('6/10')).toBeTruthy();
  });

  it('creates a one-time shared code and fragment link, then marks it copied', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(overview))
      .mockResolvedValueOnce(jsonResponse(people))
      .mockResolvedValueOnce(jsonResponse({
        code: 'JOIN-ABCDE-FGHJK-MNPQR-STUVW',
        codePrefix: 'ABCDEFGH',
        version: 1,
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        activeCode: {
          version: 1,
          codePrefix: 'ABCDEFGH',
          status: 'active',
          createdAt: '2026-08-09T00:00:00.000Z',
        },
        capacity: overview.capacity,
      }))
      .mockResolvedValueOnce(jsonResponse(people));
    const onUncopiedAccessChange = vi.fn();
    render(<AdminPeopleAccessCard onUncopiedAccessChange={onUncopiedAccessChange} />);

    await screen.findByRole('button', { name: 'Create code' });
    fireEvent.click(screen.getByRole('button', { name: 'Create code' }));

    await screen.findByText('JOIN-ABCDE-FGHJK-MNPQR-STUVW');
    expect(onUncopiedAccessChange).toHaveBeenCalledWith(true);
    expect(screen.getByText(/\/join#code=JOIN-ABCDE/).textContent).toContain('#code=');

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\/join#code=JOIN-ABCDE-FGHJK-MNPQR-STUVW$/),
    ));
    expect(onUncopiedAccessChange).toHaveBeenLastCalledWith(false);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/admin/enrollment/code',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('warns before rotation and sends the owner action to the rotation endpoint', async () => {
    const activeOverview = {
      activeCode: { version: 1, codePrefix: 'ABCDEFGH', status: 'active' },
      capacity: overview.capacity,
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(activeOverview))
      .mockResolvedValueOnce(jsonResponse(people))
      .mockResolvedValueOnce(jsonResponse({
        code: 'JOIN-12345-6789A-BCDEF-GHJKM',
        codePrefix: '12345678',
        version: 2,
      }))
      .mockResolvedValueOnce(jsonResponse({
        activeCode: { version: 2, codePrefix: '12345678', status: 'active' },
        capacity: overview.capacity,
      }))
      .mockResolvedValueOnce(jsonResponse(people));
    render(<AdminPeopleAccessCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Rotate code' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Rotate the enrollment code?' });
    expect(confirmation.textContent).toMatch(/unfinished enrollment/i);
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Rotate code' }));

    await screen.findByText('JOIN-12345-6789A-BCDEF-GHJKM');
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/admin/enrollment/code/rotate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'owner_rotation' }),
      }),
    );
  });

  it('disables the shared code without creating a replacement', async () => {
    const activeOverview = {
      activeCode: { version: 1, codePrefix: 'ABCDEFGH', status: 'active' },
      capacity: overview.capacity,
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(activeOverview))
      .mockResolvedValueOnce(jsonResponse(people))
      .mockResolvedValueOnce(jsonResponse({
        disabled: true, changed: true, revokedClaims: 1,
      }))
      .mockResolvedValueOnce(jsonResponse(overview))
      .mockResolvedValueOnce(jsonResponse(people));
    render(<AdminPeopleAccessCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Disable code' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Disable the enrollment code?' });
    expect(confirmation.textContent).toMatch(/no replacement/i);
    expect(confirmation.textContent).toMatch(/unfinished enrollment/i);
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Disable code' }));

    await waitFor(() => expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/admin/enrollment/code',
      expect.objectContaining({ method: 'DELETE' }),
    ));
    await screen.findByRole('button', { name: 'Create code' });
  });

  it('keeps a successfully disabled code closed when the follow-up refresh fails', async () => {
    const activeOverview = {
      activeCode: { version: 1, codePrefix: 'ABCDEFGH', status: 'active' },
      capacity: overview.capacity,
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(activeOverview))
      .mockResolvedValueOnce(jsonResponse(people))
      .mockResolvedValueOnce(jsonResponse({
        disabled: true, changed: true, revokedClaims: 0,
      }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Refresh unavailable' }, 503))
      .mockResolvedValueOnce(jsonResponse(people));
    render(<AdminPeopleAccessCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Disable code' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Disable the enrollment code?' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Disable code' }));

    expect(await screen.findByRole('button', { name: 'Create code' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rotate code' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disable code' })).toBeNull();
  });

  it('confirms suspension and refreshes the People list', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        activeCode: { version: 1, codePrefix: 'ABCDEFGH', status: 'active' },
        capacity: overview.capacity,
      }))
      .mockResolvedValueOnce(jsonResponse(people))
      .mockResolvedValueOnce(jsonResponse({ updated: true }))
      .mockResolvedValueOnce(jsonResponse({
        activeCode: { version: 1, codePrefix: 'ABCDEFGH', status: 'active' },
        capacity: overview.capacity,
      }))
      .mockResolvedValueOnce(jsonResponse({
        people: people.people.map((person) => person.id === 'user_1'
          ? { ...person, status: 'suspended' }
          : person),
      }));
    render(<AdminPeopleAccessCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Suspend this account?' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Suspend' }));

    await waitFor(() => expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/admin/people/user_1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ action: 'suspend' }),
      }),
    ));
    await screen.findByRole('button', { name: 'Restore' });
  });

  it('protects the current owner while allowing another owner and a revoked user to be managed', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(overview))
      .mockResolvedValueOnce(jsonResponse({
        people: [{
          ...people.people[0],
          email: 'current-owner@example.com',
        }, {
          id: 'owner_2',
          name: 'Second Owner',
          email: 'second-owner@example.com',
          role: 'owner',
          status: 'active',
          isCurrentUser: false,
        }, {
          id: 'user_revoked',
          name: 'Revoked User',
          email: 'revoked@example.com',
          role: 'user',
          status: 'revoked',
          isCurrentUser: false,
        }],
      }));

    render(<AdminPeopleAccessCard />);

    const currentOwnerRow = (await screen.findByText('current-owner@example.com')).closest('li');
    const secondOwnerRow = screen.getByText('second-owner@example.com').closest('li');
    const revokedUserRow = screen.getByText('revoked@example.com').closest('li');
    expect(currentOwnerRow).not.toBeNull();
    expect(secondOwnerRow).not.toBeNull();
    expect(revokedUserRow).not.toBeNull();
    expect(within(currentOwnerRow!).queryByRole('button')).toBeNull();
    expect(within(secondOwnerRow!).getByRole('button', { name: 'Suspend' })).toBeTruthy();
    expect(within(secondOwnerRow!).getByRole('button', { name: 'Revoke' })).toBeTruthy();
    expect(within(revokedUserRow!).getByRole('button', { name: 'Restore' })).toBeTruthy();
  });

  it('removes itself when the owner-only API rejects the current user', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 'OWNER_REQUIRED' }, 403))
      .mockResolvedValueOnce(jsonResponse({ code: 'OWNER_REQUIRED' }, 403));
    const { container } = render(<AdminPeopleAccessCard />);

    await waitFor(() => expect(container.querySelector('[data-console-panel]')).toBeNull());
  });
});
