import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const workspaceMessages = {
  sidebarKeyLabel: 'Workspace key',
  copyFullKey: 'Copy full key',
  copyPrefix: 'Copy key prefix',
  keyCopied: 'Copied!',
  recoverDialogTitle: 'Recover workspace',
};

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({
    language: 'en',
    messages: { workspace: workspaceMessages },
  }),
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
  });

  it('renders the key prefix', async () => {
    const { WorkspaceSidebarFooter } = await import('./workspace-sidebar-footer');
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceSidebarFooter, {
        accessKeyPrefix: 'dwk_f525',
        recoveryKey: null,
      })
    );

    expect(html).toContain('dwk_f525...');
    expect(html).toContain(workspaceMessages.sidebarKeyLabel);
  });

  it('renders copy button with prefix aria-label when no recovery key', async () => {
    const { WorkspaceSidebarFooter } = await import('./workspace-sidebar-footer');
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceSidebarFooter, {
        accessKeyPrefix: 'dwk_f525',
        recoveryKey: null,
      })
    );

    expect(html).toContain(`aria-label="${workspaceMessages.copyPrefix}"`);
  });

  it('renders copy button with full key aria-label when recovery key is present', async () => {
    const { WorkspaceSidebarFooter } = await import('./workspace-sidebar-footer');
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceSidebarFooter, {
        accessKeyPrefix: 'dwk_f525',
        recoveryKey: 'dwk_full_key',
      })
    );

    expect(html).toContain(`aria-label="${workspaceMessages.copyFullKey}"`);
  });

  it('renders recover button with correct aria-label', async () => {
    const { WorkspaceSidebarFooter } = await import('./workspace-sidebar-footer');
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceSidebarFooter, {
        accessKeyPrefix: 'dwk_f525',
        recoveryKey: null,
      })
    );

    expect(html).toContain(`aria-label="${workspaceMessages.recoverDialogTitle}"`);
  });
});
