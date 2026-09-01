// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const workspaceMessages = {
  sidebarKeyLabel: 'Workspace key',
  copyFullKey: 'Copy full key',
  copyPrefix: 'Copy key prefix',
  keyCopied: 'Copied!',
  recoverDialogTitle: 'Recover workspace',
};

const sidebarMock = vi.hoisted(() => ({
  isMobile: false,
  state: 'expanded' as 'expanded' | 'collapsed',
}));
const languageSetMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({
    language: 'en',
    setLanguage: languageSetMock,
    messages: {
      auth: {
        accountAccessLabel: 'Account access',
      },
      language: {
        ariaLabel: 'Switch language',
      },
      workspace: workspaceMessages,
      dashboard: {
        settings: 'Settings',
        importOldWorkspace: 'Import old workspace',
        signOut: 'Sign out',
        signingOut: 'Signing out…',
      },
    },
  }),
}));

vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => React.createElement('button', { type: 'button' }, 'Theme'),
}));

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: any) => React.createElement(React.Fragment, null, children),
  PopoverTrigger: ({ children }: any) => React.createElement(React.Fragment, null, children),
  PopoverContent: ({
    children,
    side,
    align,
    sideOffset,
    onCloseAutoFocus: _onCloseAutoFocus,
    ...props
  }: any) => React.createElement('div', {
    ...props,
    'data-side': side,
    'data-align': align,
    'data-side-offset': sideOffset,
  }, children),
}));

vi.mock('@/components/ui/sidebar', () => ({
  useSidebar: () => sidebarMock,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, 'aria-label': ariaLabel, ...props }: any) =>
    React.createElement('button', { ...props, 'aria-label': ariaLabel }, children),
}));

vi.mock('./recover-workspace-dialog', () => ({
  RecoverWorkspaceDialog: ({ open }: any) =>
    open
      ? React.createElement('div', { 'data-testid': 'recover-dialog' }, 'recover dialog')
      : null,
}));

describe('WorkspaceSidebarFooter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    languageSetMock.mockReset();
    sidebarMock.isMobile = false;
    sidebarMock.state = 'expanded';
  });

  afterEach(() => cleanup());

  it('keeps the normal account footer free of workspace keys and recovery controls', async () => {
    const { WorkspaceSidebarFooter } = await import('./workspace-sidebar-footer');
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceSidebarFooter, {
        accessKeyPrefix: 'dwk_f525',
        accountLabel: 'Niccolo',
        showRecovery: false,
      })
    );

    expect(html).toContain('Account access');
    expect(html).not.toContain('dwk_f525');
    expect(html).not.toContain(workspaceMessages.sidebarKeyLabel);
    expect(html).not.toContain(workspaceMessages.copyPrefix);
    expect(html).not.toContain(workspaceMessages.copyFullKey);
    expect(html).not.toContain(workspaceMessages.recoverDialogTitle);
  });

  it('renders account identity, settings, import, and sign-out actions in the profile popover', async () => {
    const { WorkspaceSidebarFooter } = await import('./workspace-sidebar-footer');
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceSidebarFooter, {
        accessKeyPrefix: 'dwk_f525',
        accountLabel: 'Niccolo',
        accountEmail: 'niccolo@example.com',
        settingsLabel: 'Settings',
        onImportOldWorkspace: vi.fn(),
        onSignOut: vi.fn(),
      })
    );

    expect(html).toContain('aria-label="Account access"');
    expect(html).toContain('title="Niccolo"');
    expect(html).toContain('group-data-[collapsible=icon]:size-8');
    expect(html).toContain('niccolo@example.com');
    expect(html).toContain('href="/workspace?settings=connections"');
    expect(html).toContain('Settings');
    expect(html).toContain('Import old workspace');
    expect(html).toContain('Sign out');
    expect(html).toContain('aria-label="Switch language"');
    expect(html).toContain('data-language-menu-trigger="true"');
    expect(html).toContain('English');
    expect(html).toContain('Theme');
  });

  it('anchors the expanded and mobile profile popover above the full account row', async () => {
    const { WorkspaceSidebarFooter } = await import('./workspace-sidebar-footer');
    const { rerender } = render(
      React.createElement(WorkspaceSidebarFooter, {
        accessKeyPrefix: 'dwk_f525',
        accountLabel: 'Niccolo',
      }),
    );

    const getProfilePopover = () => document.querySelector<HTMLElement>(
      '[data-workspace-profile-popover]',
    );
    const expandedPopover = getProfilePopover();
    expect(expandedPopover?.getAttribute('data-workspace-profile-placement')).toBe('account-row');
    expect(expandedPopover?.getAttribute('data-side')).toBe('top');
    expect(expandedPopover?.getAttribute('data-align')).toBe('start');
    expect(expandedPopover?.getAttribute('data-side-offset')).toBe('8');
    expect(expandedPopover?.style.width).toBe('var(--radix-popover-trigger-width)');

    sidebarMock.isMobile = true;
    sidebarMock.state = 'collapsed';
    rerender(
      React.createElement(WorkspaceSidebarFooter, {
        accessKeyPrefix: 'dwk_f525',
        accountLabel: 'Niccolo',
      }),
    );

    const mobilePopover = getProfilePopover();
    expect(mobilePopover?.getAttribute('data-workspace-profile-placement')).toBe('account-row');
    expect(mobilePopover?.getAttribute('data-side')).toBe('top');
    expect(mobilePopover?.getAttribute('data-align')).toBe('start');
    expect(mobilePopover?.getAttribute('data-side-offset')).toBe('8');
    expect(mobilePopover?.style.width).toBe('var(--radix-popover-trigger-width)');
  });

  it('opens the collapsed desktop profile popover beside the rail at padded-column width', async () => {
    sidebarMock.state = 'collapsed';
    const { WorkspaceSidebarFooter } = await import('./workspace-sidebar-footer');
    render(
      React.createElement(WorkspaceSidebarFooter, {
        accessKeyPrefix: 'dwk_f525',
        accountLabel: 'Niccolo',
      }),
    );

    const profilePopover = document.querySelector<HTMLElement>('[data-workspace-profile-popover]');
    expect(profilePopover?.getAttribute('data-workspace-profile-placement')).toBe('collapsed-rail');
    expect(profilePopover?.getAttribute('data-side')).toBe('right');
    expect(profilePopover?.getAttribute('data-align')).toBe('end');
    expect(profilePopover?.getAttribute('data-side-offset')).toBe('12');
    expect(profilePopover?.style.width).toBe(
      'min(calc(var(--studio-rail-width) - 1rem), calc(100vw - 1rem))',
    );
  });

  it('does not render legacy import or recovery actions when they are unavailable', async () => {
    const { WorkspaceSidebarFooter } = await import('./workspace-sidebar-footer');
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceSidebarFooter, {
        accessKeyPrefix: 'dwk_f525',
        showRecovery: false,
      })
    );

    expect(html).not.toContain(workspaceMessages.recoverDialogTitle);
    expect(html).not.toContain('Import old workspace');
    expect(html).not.toContain('dwk_f525');
    expect(html).not.toContain(workspaceMessages.sidebarKeyLabel);
  });

  it('runs sidebar import and sign-out actions from the profile popover', async () => {
    const onImportOldWorkspace = vi.fn();
    const onSignOut = vi.fn();
    const { WorkspaceSidebarFooter } = await import('./workspace-sidebar-footer');

    render(
      React.createElement(WorkspaceSidebarFooter, {
        accessKeyPrefix: 'dwk_f525',
        accountLabel: 'Niccolo',
        onImportOldWorkspace,
        onSignOut,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Import old workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(onImportOldWorkspace).toHaveBeenCalledTimes(1);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('uses the localized language menu label and selects a locale without navigation', async () => {
    const { WorkspaceSidebarFooter } = await import('./workspace-sidebar-footer');
    render(
      React.createElement(WorkspaceSidebarFooter, {
        accountLabel: 'Niccolo',
      }),
    );

    expect(screen.getByRole('button', { name: 'Switch language' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ខ្មែរ' }));

    expect(languageSetMock).toHaveBeenCalledWith('km');
  });

  it('opens settings through the client callback when provided', async () => {
    const onOpenSettings = vi.fn();
    const { WorkspaceSidebarFooter } = await import('./workspace-sidebar-footer');
    render(
      React.createElement(WorkspaceSidebarFooter, {
        accessKeyPrefix: 'dwk_f525',
        onOpenSettings,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('opens recovery from the key tools and disables sign out while pending', async () => {
    const { WorkspaceSidebarFooter } = await import('./workspace-sidebar-footer');

    render(
      React.createElement(WorkspaceSidebarFooter, {
        accessKeyPrefix: 'dwk_f525',
        accountLabel: 'Niccolo',
        onSignOut: vi.fn(),
        isSigningOut: true,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: workspaceMessages.recoverDialogTitle }));

    expect(screen.getByTestId('recover-dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Signing out…' }).hasAttribute('disabled')).toBe(true);
  });
});
