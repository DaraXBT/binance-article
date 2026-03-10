import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const workspaceMessages = {
  recoveryDialogTitle: 'Save your recovery key',
  recoveryDialogDescription: 'This is the only time your full recovery key will be shown.',
  recoveryDialogCopy: 'Copy key',
  recoveryDialogCopied: 'Copied',
  recoveryDialogWarning: 'You must copy the key before continuing.',
  recoveryDialogAcknowledge: 'I have saved my key',
};

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({
    language: 'en',
    messages: { workspace: workspaceMessages },
  }),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, disabled, ...props }: any) =>
    React.createElement('button', { ...props, disabled }, children),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) =>
    open ? React.createElement('div', { 'data-testid': 'dialog', role: 'dialog' }, children) : null,
  DialogContent: ({ children, showCloseButton, onEscapeKeyDown, onPointerDownOutside }: any) =>
    React.createElement(
      'div',
      {
        'data-show-close': String(showCloseButton ?? true),
        'data-blocks-escape': String(!!onEscapeKeyDown),
        'data-blocks-outside': String(!!onPointerDownOutside),
      },
      children
    ),
  DialogDescription: ({ children }: any) => React.createElement('p', null, children),
  DialogFooter: ({ children }: any) => React.createElement('div', null, children),
  DialogHeader: ({ children }: any) => React.createElement('div', null, children),
  DialogTitle: ({ children }: any) => React.createElement('h2', null, children),
}));

describe('RecoveryKeyDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('does not render when recoveryKey is null', async () => {
    const { RecoveryKeyDialog } = await import('./recovery-key-dialog');
    const html = renderToStaticMarkup(React.createElement(RecoveryKeyDialog, { recoveryKey: null }));
    expect(html).toBe('');
  });

  it('renders blocking dialog when key is present', async () => {
    const { RecoveryKeyDialog } = await import('./recovery-key-dialog');
    const html = renderToStaticMarkup(
      React.createElement(RecoveryKeyDialog, { recoveryKey: 'dwk_full_key_123' })
    );

    expect(html).toContain('dwk_full_key_123');
    expect(html).toContain(workspaceMessages.recoveryDialogTitle);
    expect(html).toContain(workspaceMessages.recoveryDialogCopy);
    expect(html).toContain(workspaceMessages.recoveryDialogAcknowledge);
  });

  it('prevents dismissal via close button, escape, and outside click', async () => {
    const { RecoveryKeyDialog } = await import('./recovery-key-dialog');
    const html = renderToStaticMarkup(
      React.createElement(RecoveryKeyDialog, { recoveryKey: 'dwk_key' })
    );

    expect(html).toContain('data-show-close="false"');
    expect(html).toContain('data-blocks-escape="true"');
    expect(html).toContain('data-blocks-outside="true"');
  });

  it('renders acknowledge button as disabled initially', async () => {
    const { RecoveryKeyDialog } = await import('./recovery-key-dialog');
    const html = renderToStaticMarkup(
      React.createElement(RecoveryKeyDialog, { recoveryKey: 'dwk_key' })
    );

    expect(html).toContain('disabled=""');
    expect(html).toContain(workspaceMessages.recoveryDialogWarning);
  });
});
