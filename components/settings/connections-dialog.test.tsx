// @vitest-environment jsdom

import React, { type ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectionsDialog } from './connections-dialog';

vi.mock('@/components/workspace-ai-credential-card', () => ({
  WorkspaceAiCredentialCard: ({ className }: { className?: string }) => (
    <div data-testid="gemini-card" className={className}>Your Gemini key</div>
  ),
}));

vi.mock('@/components/publisher-device-pairing-card', () => ({
  PublisherDevicePairingCard: ({ className, onUncopiedPairingChange }: any) => (
    <div data-testid="publisher-card" className={className}>
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

vi.mock('@/components/admin-people-access-card', () => ({
  AdminPeopleAccessCard: ({ className, onUncopiedAccessChange }: any) => (
    <section data-testid="people-access-card" className={className}>
      People &amp; access
      <button
        type="button"
        onClick={() => onUncopiedAccessChange?.(true)}
      >
        Create enrollment code
      </button>
      <button
        type="button"
        onClick={() => onUncopiedAccessChange?.(false)}
      >
        Copy enrollment link
      </button>
    </section>
  ),
}));

type RedesignedSettingsProps = Omit<
  ComponentProps<typeof ConnectionsDialog>,
  'workspaceRole'
> & {
  canManageAi: boolean;
  canManageAccess: boolean;
};

function renderSettings({
  open = true,
  onOpenChange = vi.fn(),
  canManageAi = true,
  canManageAccess = true,
}: Partial<RedesignedSettingsProps> = {}) {
  // The cast keeps this RED test executable while the production component
  // transitions from workspaceRole to explicit account capabilities.
  const props = {
    open,
    onOpenChange,
    canManageAi,
    canManageAccess,
  } as ComponentProps<typeof ConnectionsDialog>;

  return render(<ConnectionsDialog {...props} />);
}

describe('ConnectionsDialog', () => {
  afterEach(() => cleanup());

  it('presents an accessible Account settings shell with real section tabs', () => {
    renderSettings();

    const dialog = screen.getByRole('dialog', { name: 'Account settings' });
    const sectionTabs = within(dialog).getByRole('tablist', {
      name: 'Settings sections',
    });
    const aiTab = within(sectionTabs).getByRole('tab', {
      name: 'AI & generation',
    });

    expect(aiTab.getAttribute('aria-selected')).toBe('true');
    expect(within(sectionTabs).getByRole('tab', { name: 'Publishing' })).toBeTruthy();
    expect(within(sectionTabs).getByRole('tab', { name: 'People & access' })).toBeTruthy();
    expect(screen.queryAllByText('Connections', { exact: true })).toHaveLength(0);
    expect(screen.getByTestId('gemini-card')).toBeTruthy();
    expect(screen.queryByTestId('publisher-card')).toBeNull();
    expect(screen.queryByTestId('people-access-card')).toBeNull();
    expect(dialog.querySelectorAll('[data-frame-corner]')).toHaveLength(0);
    expect(dialog.className).toContain('rounded-xl');
    expect(dialog.className).toContain('border-border/80');
    expect(dialog.className).toContain('shadow-lg');
    expect(dialog.className).toContain('!max-w-5xl');
    expect(dialog.className).not.toContain('!inset-0');
    expect(screen.getByTestId('gemini-card').className).toContain('rounded-xl');
    expect(screen.getByTestId('gemini-card').className).not.toContain('rounded-none');
  });

  it('does not expose owner-only access controls to a non-owner', () => {
    renderSettings({ canManageAi: false, canManageAccess: false });

    const sectionTabs = screen.getByRole('tablist', { name: 'Settings sections' });
    expect(within(sectionTabs).getByRole('tab', { name: 'AI & generation' })).toBeTruthy();
    expect(within(sectionTabs).getByRole('tab', { name: 'Publishing' })).toBeTruthy();
    expect(within(sectionTabs).queryByRole('tab', { name: 'People & access' })).toBeNull();
    expect(screen.queryByTestId('people-access-card')).toBeNull();
  });

  it('mounts sections lazily and preserves each section after it is visited', () => {
    renderSettings();

    expect(screen.getByTestId('gemini-card')).toBeTruthy();
    expect(screen.queryByTestId('publisher-card')).toBeNull();
    expect(screen.queryByTestId('people-access-card')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Publishing' }));
    expect(screen.getByRole('tab', { name: 'Publishing' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('publisher-card')).toBeTruthy();
    expect(screen.getByTestId('publisher-card').className).toContain('rounded-xl');
    expect(screen.getByTestId('gemini-card')).toBeTruthy();
    expect(screen.queryByTestId('people-access-card')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'People & access' }));
    expect(screen.getByTestId('people-access-card')).toBeTruthy();
    expect(screen.getByTestId('people-access-card').className).toContain('rounded-xl');
    expect(screen.getByTestId('publisher-card')).toBeTruthy();
    expect(screen.getByTestId('gemini-card')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'AI & generation' }));
    expect(screen.getByRole('tab', { name: 'AI & generation' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('publisher-card')).toBeTruthy();
    expect(screen.getByTestId('people-access-card')).toBeTruthy();
  });

  it('supports keyboard navigation between settings tabs', () => {
    renderSettings();

    const aiTab = screen.getByRole('tab', { name: 'AI & generation' });
    aiTab.focus();
    fireEvent.keyDown(aiTab, { key: 'ArrowRight' });

    const publishingTab = screen.getByRole('tab', { name: 'Publishing' });
    expect(publishingTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(publishingTab);
    expect(screen.getByTestId('publisher-card')).toBeTruthy();
  });

  it('requests a close from the explicit Account settings close action', () => {
    const onOpenChange = vi.fn();
    renderSettings({ onOpenChange, canManageAccess: false });

    fireEvent.click(screen.getAllByRole('button', { name: 'Close account settings' })[0]);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('guards an uncopied code inside the settings shell without opening another dialog', () => {
    const onOpenChange = vi.fn();
    renderSettings({ onOpenChange });

    fireEvent.click(screen.getByRole('tab', { name: 'Publishing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));
    fireEvent.click(screen.getByRole('tab', { name: 'AI & generation' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Close account settings' })[0]);

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const warning = screen.getByRole('alert');
    expect(within(warning).getByRole('button', { name: 'Review code' })).toBeTruthy();
    expect(within(warning).getByRole('button', { name: 'Discard and close' })).toBeTruthy();

    fireEvent.click(within(warning).getByRole('button', { name: 'Review code' }));
    expect(screen.getByRole('tab', { name: 'Publishing' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Close account settings' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Discard and close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('retains an uncopied value when URL state closes underneath it', () => {
    const onOpenChange = vi.fn();
    const { rerender } = renderSettings({ onOpenChange });
    fireEvent.click(screen.getByRole('tab', { name: 'Publishing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));

    const closedProps = {
      open: false,
      onOpenChange,
      canManageAi: true,
      canManageAccess: true,
    } as ComponentProps<typeof ConnectionsDialog>;
    rerender(<ConnectionsDialog {...closedProps} />);

    expect(screen.getByRole('dialog', { name: 'Account settings' })).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Review code' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Review code' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('publisher-card')).toBeTruthy();
  });

  it('does not mount dialog content while closed', () => {
    renderSettings({ open: false });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('gemini-card')).toBeNull();
    expect(screen.queryByTestId('publisher-card')).toBeNull();
  });
});
