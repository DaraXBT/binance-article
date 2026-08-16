import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const workspaceMessages = {
  onboardingTitle: 'Finish opening your account',
  onboardingDescription:
    'Your account is created automatically. Import legacy articles only if you have an old recovery key.',
  createWorkspaceTitle: 'Create workspace',
  createWorkspaceDescription: 'Create a separate workspace for this account.',
  createWorkspaceAction: 'Create workspace',
  createWorkspaceLoading: 'Creating workspace...',
  recoverWorkspaceTitle: 'Import legacy articles',
  recoverWorkspaceDescription: 'Use a legacy recovery key to import older articles into this account.',
  openRecoverDialogAction: 'Import legacy articles',
  recoverDialogTitle: 'Import legacy articles',
};

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({
    language: 'en',
    messages: { workspace: workspaceMessages },
  }),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => React.createElement('button', props, children),
}));

vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => React.createElement('button', { type: 'button' }, 'Theme'),
}));

vi.mock('@/components/console/secure-console-frame', () => ({
  ConsoleHeader: ({ actions }: any) => React.createElement('header', null, actions),
  ConsolePanel: ({ children }: any) => React.createElement('section', null, children),
  SecureConsoleFrame: ({ children, title, subtitle }: any) => React.createElement(
    'main',
    null,
    title ? React.createElement('h1', null, title) : null,
    subtitle ? React.createElement('p', null, subtitle) : null,
    children,
  ),
}));

vi.mock('./recover-workspace-dialog', () => ({
  RecoverWorkspaceDialog: ({ open }: any) =>
    open ? React.createElement('div', { 'data-testid': 'recover-dialog' }, 'recover dialog') : null,
}));

vi.mock('@/lib/hooks', () => ({
  useCreateWorkspace: () => ({ isPending: false, mutate: vi.fn() }),
}));

describe('WorkspaceOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('explains automatic account setup without exposing workspace or import choices', async () => {
    const { WorkspaceOnboarding } = await import('./workspace-onboarding');
    const html = renderToStaticMarkup(React.createElement(WorkspaceOnboarding));

    expect(html).toContain(workspaceMessages.onboardingTitle);
    expect(html).not.toContain(workspaceMessages.createWorkspaceTitle);
    expect(html).not.toContain(workspaceMessages.createWorkspaceAction);
    expect(html).not.toContain(workspaceMessages.openRecoverDialogAction);
    expect(html).not.toContain(workspaceMessages.recoverDialogTitle);
    expect(html).not.toContain('new workspace');
  });
});
