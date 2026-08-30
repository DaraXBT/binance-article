// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
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
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
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
    const summary = document.querySelector('[data-capacity-summary]');
    expect(summary).toBeTruthy();
    expect(summary!.className).not.toContain('grid');
    expect(summary!.className).not.toContain('border');
    expect(summary!.className).not.toContain('bg-');
    expect(summary!.className).not.toContain('rounded');
    const personRow = await screen.findByText('Owner');
    expect(personRow.closest('li')?.className).toContain('rounded-lg');
  });

  it('keeps enrollment controls usable when only the people request fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(overview))
      .mockResolvedValueOnce(jsonResponse({ error: 'People directory unavailable.' }, 503));

    render(<AdminPeopleAccessCard />);

    const enrollmentHeading = await screen.findByRole('heading', { name: 'Enrollment code' });
    const enrollmentSection = enrollmentHeading.closest('section');
    const peopleSection = screen.getByRole('heading', { name: 'People' }).closest('section');
    expect(enrollmentSection).not.toBeNull();
    expect(peopleSection).not.toBeNull();
    expect(within(enrollmentSection!).getByRole('button', { name: 'Create code' })).toBeTruthy();
    expect(within(peopleSection!).getByRole('alert').textContent).toContain(
      'People directory unavailable.',
    );
    expect(within(peopleSection!).getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('keeps the people list usable when only enrollment access fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'Enrollment access unavailable.' }, 503))
      .mockResolvedValueOnce(jsonResponse(people));

    render(<AdminPeopleAccessCard />);

    expect(await screen.findByText('new@example.com')).toBeTruthy();
    const enrollmentSection = screen.getByRole('heading', { name: 'Enrollment code' }).closest('section');
    const peopleSection = screen.getByRole('heading', { name: 'People' }).closest('section');
    expect(enrollmentSection).not.toBeNull();
    expect(peopleSection).not.toBeNull();
    expect(within(enrollmentSection!).getByRole('alert').textContent).toContain(
      'Enrollment access unavailable.',
    );
    expect(within(enrollmentSection!).getByRole('button', { name: /retry/i })).toBeTruthy();
    expect(within(peopleSection!).getByRole('button', { name: 'Suspend' })).toBeTruthy();
  });

  it('creates a one-time shared code and fragment link, then marks it copied', async () => {
    const createRequest = deferred<Response>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(overview))
      .mockResolvedValueOnce(jsonResponse(people))
      .mockImplementationOnce(() => createRequest.promise)
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

    expect(onUncopiedAccessChange).toHaveBeenLastCalledWith(true);
    await act(async () => {
      createRequest.resolve(jsonResponse({
        code: 'JOIN-ABCDE-FGHJK-MNPQR-STUVW',
        codePrefix: 'ABCDEFGH',
        version: 1,
      }, 201));
    });

    await screen.findByText('JOIN-ABCDE-FGHJK-MNPQR-STUVW');
    expect(onUncopiedAccessChange.mock.calls).toEqual([[true]]);
    expect(screen.getByText(/\/join#code=JOIN-ABCDE/).textContent).toContain('#code=');

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\/join#code=JOIN-ABCDE-FGHJK-MNPQR-STUVW$/),
    ));
    expect(onUncopiedAccessChange).toHaveBeenLastCalledWith(false);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/admin/enrollment/code',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('releases request-time protection when code creation is canceled', async () => {
    const createRequest = deferred<Response>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(overview))
      .mockResolvedValueOnce(jsonResponse(people))
      .mockImplementationOnce(() => createRequest.promise);
    const onUncopiedAccessChange = vi.fn();
    render(<AdminPeopleAccessCard onUncopiedAccessChange={onUncopiedAccessChange} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create code' }));
    expect(onUncopiedAccessChange).toHaveBeenLastCalledWith(true);

    await act(async () => {
      createRequest.reject(new DOMException('The request was canceled.', 'AbortError'));
    });

    await waitFor(() => expect(onUncopiedAccessChange).toHaveBeenLastCalledWith(false));
    expect(screen.getByRole('alert').textContent).toContain(
      'The enrollment code could not be updated.',
    );
  });

  it('warns before rotation and sends the owner action to the rotation endpoint', async () => {
    const rotateRequest = deferred<Response>();
    const activeOverview = {
      activeCode: { version: 1, codePrefix: 'ABCDEFGH', status: 'active' },
      capacity: overview.capacity,
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(activeOverview))
      .mockResolvedValueOnce(jsonResponse(people))
      .mockImplementationOnce(() => rotateRequest.promise)
      .mockResolvedValueOnce(jsonResponse({
        activeCode: { version: 2, codePrefix: '12345678', status: 'active' },
        capacity: overview.capacity,
      }))
      .mockResolvedValueOnce(jsonResponse(people));
    const onUncopiedAccessChange = vi.fn();
    render(<AdminPeopleAccessCard onUncopiedAccessChange={onUncopiedAccessChange} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Rotate code' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Rotate the enrollment code?' });
    expect(confirmation.textContent).toMatch(/unfinished enrollment/i);
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Rotate code' }));

    expect(onUncopiedAccessChange).toHaveBeenLastCalledWith(true);
    await act(async () => {
      rotateRequest.resolve(jsonResponse({
        code: 'JOIN-12345-6789A-BCDEF-GHJKM',
        codePrefix: '12345678',
        version: 2,
      }));
    });

    await screen.findByText('JOIN-12345-6789A-BCDEF-GHJKM');
    expect(onUncopiedAccessChange.mock.calls).toEqual([[true]]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/admin/enrollment/code/rotate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'owner_rotation' }),
      }),
    );
  });

  it('reveals a validated replacement before surrounding refresh requests finish', async () => {
    const rotateRequest = deferred<Response>();
    const refreshOverviewRequest = deferred<Response>();
    const refreshPeopleRequest = deferred<Response>();
    const activeOverview = {
      activeCode: { version: 1, codePrefix: 'ABCDEFGH', status: 'active' },
      capacity: overview.capacity,
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(activeOverview))
      .mockResolvedValueOnce(jsonResponse(people))
      .mockImplementationOnce(() => rotateRequest.promise)
      .mockImplementationOnce(() => refreshOverviewRequest.promise)
      .mockImplementationOnce(() => refreshPeopleRequest.promise);
    render(<AdminPeopleAccessCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Rotate code' }));
    fireEvent.click(within(
      screen.getByRole('alertdialog', { name: 'Rotate the enrollment code?' }),
    ).getByRole('button', { name: 'Rotate code' }));

    await act(async () => {
      rotateRequest.resolve(jsonResponse({
        code: 'JOIN-NEW12-34567-89ABC-DEFGH',
        codePrefix: 'NEW12345',
        version: 2,
      }));
    });

    await waitFor(() => expect(
      screen.queryByRole('alertdialog', { name: 'Rotate the enrollment code?' }),
    ).toBeNull());
    expect(screen.getByText('JOIN-NEW12-34567-89ABC-DEFGH')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy();

    await act(async () => {
      refreshOverviewRequest.resolve(jsonResponse({
        activeCode: { version: 2, codePrefix: 'NEW12345', status: 'active' },
        capacity: overview.capacity,
      }));
      refreshPeopleRequest.resolve(jsonResponse(people));
    });
  });

  it('does not clear request protection when an old code copy resolves during rotation', async () => {
    const clipboardWrite = deferred<undefined>();
    const rotateRequest = deferred<Response>();
    writeText.mockImplementationOnce(() => clipboardWrite.promise);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(overview))
      .mockResolvedValueOnce(jsonResponse(people))
      .mockResolvedValueOnce(jsonResponse({
        code: 'JOIN-OLD12-34567-89ABC-DEFGH',
        codePrefix: 'OLD12345',
        version: 1,
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        activeCode: { version: 1, codePrefix: 'OLD12345', status: 'active' },
        capacity: overview.capacity,
      }))
      .mockResolvedValueOnce(jsonResponse(people))
      .mockImplementationOnce(() => rotateRequest.promise)
      .mockResolvedValueOnce(jsonResponse({
        activeCode: { version: 2, codePrefix: 'NEW12345', status: 'active' },
        capacity: overview.capacity,
      }))
      .mockResolvedValueOnce(jsonResponse(people));
    const onUncopiedAccessChange = vi.fn();
    render(<AdminPeopleAccessCard onUncopiedAccessChange={onUncopiedAccessChange} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create code' }));
    await screen.findByText('JOIN-OLD12-34567-89ABC-DEFGH');
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('JOIN-OLD12-34567-89ABC-DEFGH'));

    fireEvent.click(screen.getByRole('button', { name: 'Rotate code' }));
    fireEvent.click(within(
      screen.getByRole('alertdialog', { name: 'Rotate the enrollment code?' }),
    ).getByRole('button', { name: 'Rotate code' }));
    expect(onUncopiedAccessChange).toHaveBeenLastCalledWith(true);

    await act(async () => {
      clipboardWrite.resolve(undefined);
      await clipboardWrite.promise;
    });

    expect(onUncopiedAccessChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText('Copy code')).toBeTruthy();
    expect(screen.queryByText('Copied')).toBeNull();

    await act(async () => {
      rotateRequest.resolve(jsonResponse({
        code: 'JOIN-NEW12-34567-89ABC-DEFGH',
        codePrefix: 'NEW12345',
        version: 2,
      }));
    });
    expect(await screen.findByText('JOIN-NEW12-34567-89ABC-DEFGH')).toBeTruthy();
  });

  it('does not mark a replacement copied when an old code copy resolves after rotation', async () => {
    const clipboardWrite = deferred<undefined>();
    const rotateRequest = deferred<Response>();
    writeText.mockImplementationOnce(() => clipboardWrite.promise);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(overview))
      .mockResolvedValueOnce(jsonResponse(people))
      .mockResolvedValueOnce(jsonResponse({
        code: 'JOIN-OLD98-76543-21ZYX-WVUTS',
        codePrefix: 'OLD98765',
        version: 1,
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        activeCode: { version: 1, codePrefix: 'OLD98765', status: 'active' },
        capacity: overview.capacity,
      }))
      .mockResolvedValueOnce(jsonResponse(people))
      .mockImplementationOnce(() => rotateRequest.promise)
      .mockResolvedValueOnce(jsonResponse({
        activeCode: { version: 2, codePrefix: 'NEW98765', status: 'active' },
        capacity: overview.capacity,
      }))
      .mockResolvedValueOnce(jsonResponse(people));
    const onUncopiedAccessChange = vi.fn();
    render(<AdminPeopleAccessCard onUncopiedAccessChange={onUncopiedAccessChange} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create code' }));
    await screen.findByText('JOIN-OLD98-76543-21ZYX-WVUTS');
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('JOIN-OLD98-76543-21ZYX-WVUTS'));

    fireEvent.click(screen.getByRole('button', { name: 'Rotate code' }));
    fireEvent.click(within(
      screen.getByRole('alertdialog', { name: 'Rotate the enrollment code?' }),
    ).getByRole('button', { name: 'Rotate code' }));
    await act(async () => {
      rotateRequest.resolve(jsonResponse({
        code: 'JOIN-NEW98-76543-21ZYX-WVUTS',
        codePrefix: 'NEW98765',
        version: 2,
      }));
    });
    expect(await screen.findByText('JOIN-NEW98-76543-21ZYX-WVUTS')).toBeTruthy();

    await act(async () => {
      clipboardWrite.resolve(undefined);
      await clipboardWrite.promise;
    });

    expect(onUncopiedAccessChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
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

  it('ignores a delayed disable completion from an unmounted card session', async () => {
    const activeOverview = {
      activeCode: { version: 1, codePrefix: 'ABCDEFGH', status: 'active' },
      capacity: overview.capacity,
    };
    const disableRequest = deferred<Response>();
    const createRequest = deferred<Response>();
    let enrollmentGetCount = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method?.toUpperCase() ?? 'GET';

      if (url === '/api/admin/enrollment' && method === 'GET') {
        enrollmentGetCount += 1;
        return Promise.resolve(jsonResponse(enrollmentGetCount === 1 ? activeOverview : overview));
      }
      if (url === '/api/admin/people' && method === 'GET') {
        return Promise.resolve(jsonResponse(people));
      }
      if (url === '/api/admin/enrollment/code' && method === 'DELETE') {
        return disableRequest.promise;
      }
      if (url === '/api/admin/enrollment/code' && method === 'POST') {
        return createRequest.promise;
      }
      return Promise.resolve(jsonResponse({ error: 'Unexpected admin request.' }, 500));
    });
    const onUncopiedAccessChange = vi.fn();
    const oldSession = render(
      <AdminPeopleAccessCard onUncopiedAccessChange={onUncopiedAccessChange} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Disable code' }));
    fireEvent.click(within(
      screen.getByRole('alertdialog', { name: 'Disable the enrollment code?' }),
    ).getByRole('button', { name: 'Disable code' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/enrollment/code',
      expect.objectContaining({ method: 'DELETE' }),
    ));

    oldSession.unmount();
    render(<AdminPeopleAccessCard onUncopiedAccessChange={onUncopiedAccessChange} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create code' }));
    expect(onUncopiedAccessChange).toHaveBeenLastCalledWith(true);

    await act(async () => {
      disableRequest.resolve(jsonResponse({
        disabled: true,
        changed: true,
        revokedClaims: 0,
      }));
      await disableRequest.promise;
      await Promise.resolve();
    });

    expect(onUncopiedAccessChange.mock.calls).toEqual([[true]]);
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
    expect(screen.getByRole('alert').textContent).toContain('Refresh unavailable');
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

  it('keeps a failed account mutation open and shows its error inside the confirmation', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(overview))
      .mockResolvedValueOnce(jsonResponse(people))
      .mockResolvedValueOnce(jsonResponse({
        error: 'The account could not be suspended. Try again.',
        code: 'PERSON_UPDATE_FAILED',
      }, 503));
    render(<AdminPeopleAccessCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Suspend this account?' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Suspend' }));

    const openConfirmation = await screen.findByRole('alertdialog', {
      name: 'Suspend this account?',
    });
    await waitFor(() => expect(within(openConfirmation).getByRole('alert').textContent).toContain(
      'The account could not be suspended. Try again.',
    ));
    expect(screen.getByText('new@example.com').closest('li')?.textContent).toContain('active');
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
    expect(within(currentOwnerRow!).getByText('Administrator')).toBeTruthy();
    expect(within(secondOwnerRow!).getByText('Administrator')).toBeTruthy();
    expect(document.body.textContent).toContain(
      'Each person receives a separate personal account and private article library.',
    );
    expect(document.body.textContent).not.toMatch(/workspace owner|workspace member/i);
  });

  it('removes itself when the owner-only API rejects the current user', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 'OWNER_REQUIRED' }, 403))
      .mockResolvedValueOnce(jsonResponse({ code: 'OWNER_REQUIRED' }, 403));
    const { container } = render(<AdminPeopleAccessCard />);

    await waitFor(() => expect(container.querySelector('[data-console-panel]')).toBeNull());
  });

  it('does not silently hide an account-disabled response as an owner permission failure', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        error: 'This account is disabled.',
        code: 'ACCOUNT_DISABLED',
      }, 403))
      .mockResolvedValueOnce(jsonResponse({
        error: 'This account is disabled.',
        code: 'ACCOUNT_DISABLED',
      }, 403));
    const { container } = render(<AdminPeopleAccessCard />);

    const alerts = await screen.findAllByRole('alert');
    expect(container.querySelector('[data-console-panel]')).not.toBeNull();
    expect(alerts.some((alert) => /account is disabled/i.test(alert.textContent ?? ''))).toBe(true);
  });
});
