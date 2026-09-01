// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const workspaceMessages = {
  recoverDialogTitle: 'Recover workspace',
  recoverDialogDescription: 'Paste your recovery key to attach this browser.',
  recoverDialogPlaceholder: 'Paste workspace recovery key',
  recoverDialogAction: 'Recover',
  recoverDialogRecovering: 'Recovering...',
  recoverDialogSuccess: 'Workspace recovered for this browser.',
  recoverDialogFailed: 'Failed to recover workspace.',
  recoverDialogKeyRequired: 'Recovery key is required.',
};

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({
    language: 'en',
    messages: { workspace: workspaceMessages },
  }),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) =>
    React.createElement('button', props, children),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: any) => React.createElement('input', props),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) =>
    open ? React.createElement('div', { role: 'dialog' }, children) : null,
  DialogContent: ({ children }: any) => React.createElement('div', null, children),
  DialogDescription: ({ children }: any) => React.createElement('p', null, children),
  DialogFooter: ({ children }: any) => React.createElement('div', null, children),
  DialogHeader: ({ children }: any) => React.createElement('div', null, children),
  DialogTitle: ({ children }: any) => React.createElement('h2', null, children),
}));

const mutateAsync = vi.fn();

vi.mock('@/lib/hooks', () => ({
  useRecoverWorkspace: () => ({ isPending: false, mutateAsync }),
}));

describe('RecoverWorkspaceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => cleanup());

  it('does not render when open is false', async () => {
    const { RecoverWorkspaceDialog } = await import('./recover-workspace-dialog');
    const html = renderToStaticMarkup(
      React.createElement(RecoverWorkspaceDialog, { open: false, onOpenChange: vi.fn() })
    );
    expect(html).toBe('');
  });

  it('renders dialog with title and input when open', async () => {
    const { RecoverWorkspaceDialog } = await import('./recover-workspace-dialog');
    const html = renderToStaticMarkup(
      React.createElement(RecoverWorkspaceDialog, { open: true, onOpenChange: vi.fn() })
    );

    expect(html).toContain(workspaceMessages.recoverDialogTitle);
    expect(html).toContain(workspaceMessages.recoverDialogDescription);
    expect(html).toContain(workspaceMessages.recoverDialogAction);
  });

  it('renders the recover action button', async () => {
    const { RecoverWorkspaceDialog } = await import('./recover-workspace-dialog');
    const html = renderToStaticMarkup(
      React.createElement(RecoverWorkspaceDialog, { open: true, onOpenChange: vi.fn() })
    );

    expect(html).toContain(workspaceMessages.recoverDialogAction);
  });

  it('uses a localized recovery error instead of remote error details', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('upstream diagnostic that must stay private'));
    const { RecoverWorkspaceDialog } = await import('./recover-workspace-dialog');

    render(React.createElement(RecoverWorkspaceDialog, { open: true, onOpenChange: vi.fn() }));
    fireEvent.change(screen.getByPlaceholderText(workspaceMessages.recoverDialogPlaceholder), {
      target: { value: 'dwk_example' },
    });
    fireEvent.click(screen.getByRole('button', { name: workspaceMessages.recoverDialogAction }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(workspaceMessages.recoverDialogFailed);
    });
    expect(screen.queryByText('upstream diagnostic that must stay private')).toBeNull();
  });
});
