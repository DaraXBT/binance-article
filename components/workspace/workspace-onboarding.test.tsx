import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const workspaceMessages = {
  onboardingTitle: 'Set up your workspace',
  onboardingDescription:
    'Create a new recovery key or reconnect an existing workspace before entering the dashboard.',
  createWorkspaceTitle: 'Create a new workspace key',
  createWorkspaceDescription: 'Generate a new recovery key for this browser session.',
  createWorkspaceAction: 'Create new key',
  createWorkspaceLoading: 'Creating key...',
  recoverWorkspaceTitle: 'Recover an existing workspace',
  recoverWorkspaceDescription: 'Use a previously saved recovery key to reconnect this browser.',
  openRecoverDialogAction: 'Use existing key',
  recoverDialogTitle: 'Recover workspace',
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

  it('renders explicit create and recover actions', async () => {
    const { WorkspaceOnboarding } = await import('./workspace-onboarding');
    const html = renderToStaticMarkup(React.createElement(WorkspaceOnboarding));

    expect(html).toContain(workspaceMessages.onboardingTitle);
    expect(html).toContain(workspaceMessages.createWorkspaceAction);
    expect(html).toContain(workspaceMessages.openRecoverDialogAction);
  });
});
