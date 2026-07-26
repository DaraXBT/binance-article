// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  afterEach(() => cleanup());

  it('shows only a fixed mask and clears the password field after save', async () => {
    render(<WorkspaceAiCredentialCard workspaceRole="owner" />);
    const input = screen.getByLabelText('Replace workspace key') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'workspace-secret-key-with-enough-length' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    await waitFor(() => expect(input.value).toBe(''));
    expect(screen.getByText(/Stored key:/)).toBeTruthy();
    expect(screen.queryByText(/secret-key-with-enough-length/)).toBeNull();
    expect(screen.getByDisplayValue('').getAttribute('type')).toBe('password');
  });

  it('does not expose credential status or controls to members', () => {
    render(<WorkspaceAiCredentialCard workspaceRole="member" />);
    expect(screen.getByText(/managed by the workspace owner/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /save|replace|test|delete/i })).toBeNull();
    expect(mocks.useWorkspaceAiCredential).toHaveBeenCalledWith(false);
  });
});
