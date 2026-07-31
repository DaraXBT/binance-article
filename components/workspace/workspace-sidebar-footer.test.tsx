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

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({
    language: 'en',
    messages: {
      workspace: workspaceMessages,
      dashboard: {
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
    sidebarMock.isMobile = false;
    sidebarMock.state = 'expanded';
  });

  afterEach(() => cleanup());

  it('renders the key prefix', async () => {
    const { WorkspaceSidebarFooter } = await import('./workspace-sidebar-footer');
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceSidebarFooter, {
        accessKeyPrefix: 'dwk_f525',
      })
    );

    expect(html).toContain('dwk_f525...');
    expect(html).toContain(workspaceMessages.sidebarKeyLabel);
  });

  it('always labels the copy button with the key prefix (full keys are never exposed)', async () => {
    const { WorkspaceSidebarFooter } = await import('./workspace-sidebar-footer');
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceSidebarFooter, {
        accessKeyPrefix: 'dwk_f525',
      })
    );

    expect(html).toContain(`aria-label="${workspaceMessages.copyPrefix}"`);
    expect(html).not.toContain(`aria-label="${workspaceMessages.copyFullKey}"`);
  });

  it('renders recover button with correct aria-label', async () => {
    const { WorkspaceSidebarFooter } = await import('./workspace-sidebar-footer');
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceSidebarFooter, {
        accessKeyPrefix: 'dwk_f525',
      })
    );

    expect(html).toContain(`aria-label="${workspaceMessages.recoverDialogTitle}"`);
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

    expect(html).toContain('aria-label="Account: Niccolo"');
    expect(html).toContain('title="Niccolo"');
    expect(html).toContain('group-data-[collapsible=icon]:size-8');
    expect(html).toContain('niccolo@example.com');
    expect(html).toContain('href="/workspace?settings=connections"');
    expect(html).toContain('Settings');
    expect(html).toContain('Import old workspace');
    expect(html).toContain('Sign out');
    expect(html).not.toContain('Language');
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
