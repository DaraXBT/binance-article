// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useWorkspaceAiCredential: vi.fn(),
  useSaveWorkspaceAiCredential: vi.fn(),
  useTestWorkspaceAiCredential: vi.fn(),
  useSetWorkspaceAiCredentialSource: vi.fn(),
  useDeleteWorkspaceAiCredential: vi.fn(),
}));

vi.mock('@/lib/hooks', () => mocks);

import { WorkspaceAiCredentialCard } from './workspace-ai-credential-card';

function mutation() {
  return {
    isPending: false,
    error: null,
    mutateAsync: vi.fn(async () => ({
      provider: 'gemini' as const,
      configured: true,
      activeSource: 'platform' as const,
      validatedAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
    })),
  };
}

describe('WorkspaceAiCredentialCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useWorkspaceAiCredential.mockReturnValue({
      data: {
        provider: 'gemini', configured: true, activeSource: 'platform',
        validatedAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:00:00.000Z',
      }, isLoading: false, error: null,
    });
    mocks.useSaveWorkspaceAiCredential.mockReturnValue(mutation());
    mocks.useTestWorkspaceAiCredential.mockReturnValue(mutation());
    mocks.useSetWorkspaceAiCredentialSource.mockReturnValue(mutation());
    mocks.useDeleteWorkspaceAiCredential.mockReturnValue(mutation());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('does not expose assumed credential controls while the connection is loading', () => {
    mocks.useWorkspaceAiCredential.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    render(<WorkspaceAiCredentialCard workspaceRole="owner" />);

    expect(screen.getByText(/loading gemini connection/i)).toBeTruthy();
    const keyInput = screen.queryByLabelText(/your gemini key/i) as HTMLInputElement | null;
    const testButton = screen.queryByRole('button', { name: 'Test connection' });
    const deleteButton = screen.queryByRole('button', { name: 'Delete key' });
    expect(keyInput === null || keyInput.disabled).toBe(true);
    expect(testButton === null || (testButton as HTMLButtonElement).disabled).toBe(true);
    expect(deleteButton === null || (deleteButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers an explicit retry when the initial credential request fails', async () => {
    const refetch = vi.fn();
    mocks.useWorkspaceAiCredential.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Gemini connection could not be loaded.'),
      refetch,
    });

    render(<WorkspaceAiCredentialCard workspaceRole="owner" />);

    expect(screen.getByRole('alert').textContent).toContain(
      'Gemini connection could not be loaded.',
    );
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows only a fixed mask and clears the password field after save', async () => {
    render(<WorkspaceAiCredentialCard workspaceRole="owner" />);
    const input = screen.getByLabelText('Replace your Gemini key') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'personal-secret-key-with-enough-length' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    await waitFor(() => expect(input.value).toBe(''));
    expect(screen.getByText(/Stored key:/)).toBeTruthy();
    expect(screen.queryByText(/secret-key-with-enough-length/)).toBeNull();
    expect(screen.getByDisplayValue('').getAttribute('type')).toBe('password');
  });

  it('presents Gemini as a personal account connection without member-owner language', () => {
    render(<WorkspaceAiCredentialCard workspaceRole="owner" />);

    const visibleCopy = document.body.textContent ?? '';
    expect(visibleCopy).toContain('Your Gemini key');
    expect(visibleCopy).toMatch(/your account/i);
    expect(visibleCopy).not.toMatch(/workspace|workspace owner|workspace member/i);
    expect(mocks.useWorkspaceAiCredential).toHaveBeenCalledWith(true);
  });

  it('uses an in-app confirmation before deleting a saved key', async () => {
    const deleteMutation = mutation();
    mocks.useDeleteWorkspaceAiCredential.mockReturnValue(deleteMutation);
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<WorkspaceAiCredentialCard workspaceRole="owner" />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete key' }));

    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(deleteMutation.mutateAsync).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('alertdialog');
    expect(confirmation.textContent).toMatch(/delete/i);
    expect(confirmation.textContent).toMatch(/google/i);

    fireEvent.click(within(confirmation).getByRole('button', { name: /delete key/i }));
    await waitFor(() => expect(deleteMutation.mutateAsync).toHaveBeenCalledTimes(1));
  });
});
