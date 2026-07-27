// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectionsDialog } from './connections-dialog';

vi.mock('@/components/workspace-ai-credential-card', () => ({
  WorkspaceAiCredentialCard: ({ workspaceRole }: { workspaceRole?: string }) => (
    <div data-testid="gemini-card">Gemini role: {workspaceRole}</div>
  ),
}));

vi.mock('@/components/publisher-device-pairing-card', () => ({
  PublisherDevicePairingCard: ({ onUncopiedPairingChange }: any) => (
    <div data-testid="publisher-card">
      Browser publisher
      <button
        type="button"
        onClick={() => onUncopiedPairingChange?.(true)}
      >
        Create pairing code
      </button>
      <button
        type="button"
        onClick={() => onUncopiedPairingChange?.(false)}
      >
        Copy pairing code
      </button>
    </div>
  ),
}));

vi.mock('@/components/admin-invitations-card', () => ({
  AdminInvitationsCard: ({ onUncopiedInvitationChange }: any) => (
    <section data-testid="invitations-card">
      Invitations
      <button
        type="button"
        onClick={() => onUncopiedInvitationChange?.(true)}
      >
        Create one-time link
      </button>
      <button
        type="button"
        onClick={() => onUncopiedInvitationChange?.(false)}
      >
        Copy one-time link
      </button>
    </section>
  ),
}));

describe('ConnectionsDialog', () => {
  afterEach(() => cleanup());

  it('presents all connection workflows in one labelled dialog', () => {
    render(
      <ConnectionsDialog open onOpenChange={vi.fn()} workspaceRole="owner" />,
    );

    expect(screen.getByRole('dialog', { name: 'Connections' })).toBeTruthy();
    expect(screen.getByText(
      'Manage the AI provider and browser publisher connections used by this workspace.',
    )).toBeTruthy();
    expect(screen.getByTestId('gemini-card').textContent).toContain('owner');
    expect(screen.getByTestId('publisher-card')).toBeTruthy();
    expect(screen.getByTestId('invitations-card')).toBeTruthy();
    expect(document.querySelector('[data-connections-dialog-scroll]')).toBeTruthy();
  });

  it('requests a close from the explicit close action', () => {
    const onOpenChange = vi.fn();
    render(
      <ConnectionsDialog open onOpenChange={onOpenChange} workspaceRole="member" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close connections' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('confirms before discarding a one-time invitation link', () => {
    const onOpenChange = vi.fn();
    render(
      <ConnectionsDialog open onOpenChange={onOpenChange} workspaceRole="owner" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create one-time link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close connections' }));

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Close before copying?' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close anyway' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('retains an uncopied pairing code when URL state closes underneath it', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ConnectionsDialog open onOpenChange={onOpenChange} workspaceRole="owner" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));

    rerender(
      <ConnectionsDialog open={false} onOpenChange={onOpenChange} workspaceRole="owner" />,
    );

    expect(document.querySelector('[data-connections-dialog]')).toBeTruthy();
    expect(screen.getByRole('alertdialog', { name: 'Close before copying?' })).toBeTruthy();
    expect(screen.getByTestId('publisher-card')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Keep connections open' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('does not mount dialog content while closed', () => {
    render(
      <ConnectionsDialog open={false} onOpenChange={vi.fn()} workspaceRole="owner" />,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('publisher-card')).toBeNull();
  });
});
