// @vitest-environment jsdom

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const messages = {
  publicHome: {
    resumeUnavailable: 'That draft is no longer available in this tab.',
    storageError: 'This browser could not preserve the draft.',
    promptTooShort: 'Add at least 10 characters.',
  },
  common: {
    cancel: 'Cancel',
    delete: 'Delete',
    newDeck: 'New article',
    rename: 'Rename',
    retry: 'Retry',
  },
  accessGate: {
    title: 'Private access',
    description: 'Enter the access code to continue into this workspace.',
    codePlaceholder: 'Enter access code',
    submit: 'Continue',
    submitting: 'Checking...',
    invalidCode: 'Invalid access code',
  },
  dashboard: {
    workspaceDashboard: 'Workspace dashboard',
    searchDecks: 'Search articles',
    allDecks: 'All articles',
    couldNotLoadDeckList: 'Could not load your article list.',
    noMatchingDecks: 'No articles match this search.',
    noDecksYet: 'No articles yet. Create one to get started.',
    renameTitleRequired: 'Title is required.',
    renameArticleFailed: 'Failed to rename article',
    headerTitle: 'Dashboard',
    loadErrorTitle: 'Articles could not be loaded.',
    loadErrorDescription: 'The dashboard shell is available, but the list failed to load.',
    promptHomeTitle: 'What do you want to write about?',
    promptHomeSubtitle: 'Start with a topic. We will turn it into a full AI-generated article.',
    topicPlaceholder: 'Enter a topic or angle',
    promptPlaceholder: 'Add your own instructions or let AI suggest them.',
    promptHintEmpty: 'Enter a topic first, then ask AI for a suggestion.',
    promptHintReady: 'You can refine the prompt before generating.',
    generationLockedHint: 'Generation is locked for this browser.',
    generationLockedBanner: 'Generation stays locked until this browser is unlocked.',
    aiSuggest: 'AI Suggest',
    aiSuggestLoading: 'Suggesting...',
    slideCountLabel: 'Slides',
    illustrationStyleLabel: 'Style',
    generateAction: 'Generate article',
    generateLoading: 'Generating article...',
    topicRequired: 'A topic is required.',
    promptRequired: 'A prompt is required.',
    promptGenerateFailed: 'Failed to generate prompt',
    articleGenerateFailed: 'Failed to generate article',
    connections: 'Localized connections',
    importOldWorkspace: 'Localized import workspace',
    signOut: 'Localized sign out',
    signingOut: 'Localized signing out…',
  },
  newDeck: {
    styleOptions: {
      'pixel-art': {
        name: 'Pixel Art',
      },
      'fantasy-animation': {
        name: 'Fantasy Animation',
      },
      'lab-notes': {
        name: 'Lab Notes',
      },
    },
  },
  deckPage: {
    deleteArticleTitle: 'Delete this article?',
    deleteArticleDescription: 'This permanently deletes the article.',
  },
  deckCard: {
    slides: 'Slides',
    updated: 'Updated',
  },
  generateAccess: {
    title: 'Generation Access Code',
    description: 'Enter the generation access code to unlock article generation.',
    codeLabel: 'Access Code',
    codePlaceholder: 'Enter generation code',
    submit: 'Unlock Generation',
    submitting: 'Verifying...',
    invalidCode: 'Invalid generation code. Please try again.',
  },
  workspace: {
    onboardingTitle: 'Set up your workspace',
    onboardingDescription: 'Create a new recovery key or reconnect an existing workspace before entering the dashboard.',
    createWorkspaceTitle: 'Create a new workspace key',
    createWorkspaceDescription: 'Generate a new recovery key for this browser session.',
    createWorkspaceAction: 'Create new key',
    createWorkspaceLoading: 'Creating key...',
    recoverWorkspaceTitle: 'Recover an existing workspace',
    recoverWorkspaceDescription: 'Use a previously saved recovery key to reconnect this browser.',
    openRecoverDialogAction: 'Use existing key',
    bootstrapLoadingTitle: 'Loading workspace',
    bootstrapLoadingDescription: 'We are checking your workspace before opening the dashboard.',
    bootstrapErrorTitle: 'Workspace unavailable',
    bootstrapErrorDescription: 'We could not load your workspace right now. Try again to reconnect this browser.',
    sidebarKeyLabel: 'Workspace key',
    copyFullKey: 'Copy full key',
    copyPrefix: 'Copy key prefix',
    keyCopied: 'Copied!',
    recoverDialogTitle: 'Recover workspace',
  },
};

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}));

const routerPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({ language: 'en', messages }),
}));

vi.mock('@/components/language-toggle', () => ({
  LanguageToggle: () => React.createElement('button', { type: 'button' }, 'Language'),
}));

vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => React.createElement('button', { type: 'button' }, 'Theme'),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ asChild, children, ...props }: any) =>
    asChild ? React.createElement(React.Fragment, null, children) : React.createElement('button', props, children),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: any) => React.createElement('input', props),
}));

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: any) => React.createElement('textarea', props),
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, onOpenChange }: any) => React.createElement(
    React.Fragment,
    null,
    React.createElement('button', {
      type: 'button',
      onClick: () => onOpenChange?.(false),
    }, 'Dismiss mandatory choice'),
    children,
  ),
  AlertDialogAction: ({ children, ...props }: any) => React.createElement('button', props, children),
  AlertDialogCancel: ({ children, ...props }: any) => React.createElement(
    'button',
    { 'data-testid': 'alert-dialog-cancel', ...props },
    children,
  ),
  AlertDialogContent: ({ children }: any) => React.createElement('div', null, children),
  AlertDialogDescription: ({ children }: any) => React.createElement('p', null, children),
  AlertDialogFooter: ({ children }: any) => React.createElement('div', null, children),
  AlertDialogHeader: ({ children }: any) => React.createElement('div', null, children),
  AlertDialogTitle: ({ children }: any) => React.createElement('h2', null, children),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => React.createElement(React.Fragment, null, children),
  DropdownMenuContent: ({ children }: any) => React.createElement('div', null, children),
  DropdownMenuItem: ({ children, asChild: _asChild, ...props }: any) =>
    React.createElement('button', props, children),
  DropdownMenuTrigger: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/ui/sidebar', () => ({
  Sidebar: ({ children }: any) => React.createElement('aside', null, children),
  SidebarContent: ({ children }: any) => React.createElement('div', null, children),
  SidebarFooter: ({ children }: any) => React.createElement('div', { 'data-testid': 'sidebar-footer' }, children),
  SidebarGroup: ({ children }: any) => React.createElement('div', null, children),
  SidebarGroupContent: ({ children }: any) => React.createElement('div', null, children),
  SidebarGroupLabel: ({ children }: any) => React.createElement('div', null, children),
  SidebarHeader: ({ children }: any) => React.createElement('div', null, children),
  SidebarInset: ({ children }: any) => React.createElement('main', null, children),
  SidebarMenu: ({ children }: any) => React.createElement('div', null, children),
  SidebarMenuButton: ({ asChild, children, ...props }: any) =>
    asChild ? React.createElement(React.Fragment, null, children) : React.createElement('button', props, children),
  SidebarMenuItem: ({ children }: any) => React.createElement('div', null, children),
  SidebarMenuSkeleton: () => React.createElement('div', null, 'skeleton'),
  SidebarProvider: ({ children }: any) => React.createElement('div', null, children),
  SidebarRail: () => React.createElement('div'),
  SidebarSeparator: () => React.createElement('hr'),
  SidebarTrigger: () => React.createElement('button', { type: 'button' }, 'Toggle sidebar'),
}));

vi.mock('@/components/workspace/recovery-key-dialog', () => ({
  RecoveryKeyDialog: ({ recoveryKey }: any) =>
    recoveryKey
      ? React.createElement('div', { 'data-testid': 'recovery-key-dialog' }, recoveryKey)
      : null,
}));

vi.mock('@/components/workspace/workspace-sidebar-footer', () => ({
  WorkspaceSidebarFooter: ({ accessKeyPrefix }: any) =>
    React.createElement('div', { 'data-testid': 'workspace-sidebar-footer' }, accessKeyPrefix),
}));

vi.mock('@/components/workspace/workspace-onboarding', () => ({
  WorkspaceOnboarding: () =>
    React.createElement('div', { 'data-testid': 'workspace-onboarding' }, messages.workspace.onboardingTitle),
}));

vi.mock('@/components/generate-access-dialog', () => ({
  GenerateAccessDialog: ({ open, onSuccess, onOpenChange }: any) =>
    open
      ? React.createElement(
          'div',
          { 'data-testid': 'generate-access-dialog' },
          'Generate Access Dialog',
          React.createElement('button', {
            type: 'button',
            onClick: () => {
              onSuccess?.();
              onOpenChange?.(false);
            },
          }, 'Unlock test access'),
        )
      : null,
}));

const refetch = vi.fn();
const refetchWorkspace = vi.fn();
const mutate = vi.fn();
const createWorkspaceMutate = vi.fn();
let workspaceData:
  | {
      hasWorkspace: boolean;
      workspaceId: string | null;
      accessKeyPrefix: string | null;
      recoveryKey: string | null;
      generateAccessEnabled: boolean;
      hasGenerationAccess: boolean;
      generationAccessInvalidReason: string | null;
    }
  | undefined = {
  hasWorkspace: true,
  workspaceId: 'workspace-1',
  accessKeyPrefix: 'dwk_test',
  recoveryKey: null,
  generateAccessEnabled: false,
  hasGenerationAccess: true,
  generationAccessInvalidReason: null,
};
let workspaceIsLoading = false;
let workspaceError: Error | null = null;

vi.mock('@/lib/hooks', () => ({
  useDecks: () => ({ data: [], isLoading: false, isError: false, refetch }),
  useWorkspace: () => ({
    data: workspaceData,
    isLoading: workspaceIsLoading,
    error: workspaceError,
    refetch: refetchWorkspace,
  }),
  useUpdateDeck: () => ({ isPending: false, mutate }),
  useDeleteDeck: () => ({ isPending: false, mutate }),
  useCreateWorkspace: () => ({ isPending: false, mutate: createWorkspaceMutate }),
}));

describe('DashboardHome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    sessionStorage.clear();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    workspaceData = {
      hasWorkspace: true,
      workspaceId: 'workspace-1',
      accessKeyPrefix: 'dwk_test',
      recoveryKey: null,
      generateAccessEnabled: false,
      hasGenerationAccess: true,
      generationAccessInvalidReason: null,
    };
    workspaceIsLoading = false;
    workspaceError = null;
    createWorkspaceMutate.mockReset();
  });

  afterEach(() => {
    cleanup();
    routerPush.mockReset();
    refetch.mockReset();
    refetchWorkspace.mockReset();
    vi.resetAllMocks();
  });

  it('shows visible loading UI while workspace status is still loading', async () => {
    workspaceData = undefined;
    workspaceIsLoading = true;

    const { DashboardHome } = await import('@/components/home/dashboard-home');
    const html = renderToStaticMarkup(React.createElement(DashboardHome));

    expect(html).toContain(messages.workspace.bootstrapLoadingTitle);
    expect(html).not.toContain('data-testid="workspace-onboarding"');
    expect(html).not.toContain(messages.dashboard.promptHomeTitle);
  });

  it('shows a workspace bootstrap error state instead of a blank screen', async () => {
    workspaceData = undefined;
    workspaceError = new Error('Failed to fetch workspace');

    const { DashboardHome } = await import('@/components/home/dashboard-home');
    const html = renderToStaticMarkup(React.createElement(DashboardHome));

    expect(html).toContain(messages.workspace.bootstrapErrorTitle);
    expect(html).toContain('Failed to fetch workspace');
    expect(html).toContain(messages.common.retry);
    expect(html).not.toContain('data-testid="workspace-onboarding"');
    expect(html).not.toContain(messages.dashboard.promptHomeTitle);
  });

  it('retries workspace bootstrap when the retry action is clicked', async () => {
    workspaceData = undefined;
    workspaceError = new Error('Failed to fetch workspace');

    const { DashboardHome } = await import('@/components/home/dashboard-home');

    render(React.createElement(DashboardHome));

    fireEvent.click(screen.getByRole('button', { name: messages.common.retry }));

    expect(refetchWorkspace).toHaveBeenCalledTimes(1);
  });

  it('automatically provisions an account workspace once when none is attached', async () => {
    workspaceData = {
      hasWorkspace: false,
      workspaceId: null,
      accessKeyPrefix: null,
      recoveryKey: null,
      generateAccessEnabled: false,
      hasGenerationAccess: false,
      generationAccessInvalidReason: null,
    };

    const { DashboardHome } = await import('@/components/home/dashboard-home');
    render(React.createElement(DashboardHome));

    await waitFor(() => expect(createWorkspaceMutate).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('heading', { name: messages.workspace.bootstrapLoadingTitle })).toBeTruthy();
  });

  it('renders a prompt-first home composer after a workspace is attached', async () => {
    const { DashboardHome } = await import('@/components/home/dashboard-home');

    const html = renderToStaticMarkup(React.createElement(DashboardHome));

    expect(html).toContain(messages.dashboard.promptHomeTitle);
    expect(html).toContain(messages.dashboard.aiSuggest);
    expect(html).not.toContain('ai-suggest-glow');
    expect(html).toContain('border-primary');
    expect(html).toContain(messages.dashboard.generateAction);
  });

  it('renders workspace sidebar footer with key prefix only after workspace attachment', async () => {
    const { DashboardHome } = await import('@/components/home/dashboard-home');
    const html = renderToStaticMarkup(React.createElement(DashboardHome));

    expect(html).toContain('data-testid="workspace-sidebar-footer"');
    expect(html).toContain('dwk_test');
  });

  it('renders recovery key dialog when bootstrap returns a recovery key', async () => {
    workspaceData = {
      hasWorkspace: true,
      workspaceId: 'workspace-1',
      accessKeyPrefix: 'dwk_test',
      recoveryKey: 'dwk_secret_123',
      generateAccessEnabled: false,
      hasGenerationAccess: true,
      generationAccessInvalidReason: null,
    };

    const { DashboardHome } = await import('@/components/home/dashboard-home');
    const html = renderToStaticMarkup(React.createElement(DashboardHome));

    expect(html).toContain('data-testid="recovery-key-dialog"');
    expect(html).toContain('dwk_secret_123');
  });

  it('does not render recovery key dialog when no recovery key is present', async () => {
    const { DashboardHome } = await import('@/components/home/dashboard-home');
    const html = renderToStaticMarkup(React.createElement(DashboardHome));

    expect(html).not.toContain('data-testid="recovery-key-dialog"');
  });

  it('keeps locked generation actions clickable and opens access on the first paid action', async () => {
    workspaceData = {
      hasWorkspace: true,
      workspaceId: 'workspace-1',
      accessKeyPrefix: 'dwk_test',
      recoveryKey: null,
      generateAccessEnabled: true,
      hasGenerationAccess: false,
      generationAccessInvalidReason: 'missing',
    };

    const { DashboardHome } = await import('@/components/home/dashboard-home');
    render(React.createElement(DashboardHome));

    expect(screen.queryByText(messages.dashboard.generationLockedBanner)).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(messages.dashboard.promptPlaceholder), {
      target: { value: 'This is a sufficiently detailed article prompt.' },
    });
    const generate = screen.getByRole('button', { name: messages.dashboard.generateAction });
    expect(generate.hasAttribute('disabled')).toBe(false);
    fireEvent.click(generate);
    expect(screen.getByTestId('generate-access-dialog')).toBeTruthy();
  });

  it('claims a submitted public draft and asks for access before calling a paid API', async () => {
    workspaceData = {
      hasWorkspace: true,
      workspaceId: 'workspace-1',
      accessKeyPrefix: 'dwk_test',
      recoveryKey: null,
      generateAccessEnabled: true,
      hasGenerationAccess: false,
      generationAccessInvalidReason: 'missing',
    };
    const intentId = '11111111-1111-4111-8111-111111111111';
    const prompt = 'Explain tokenized gold settlement for crypto traders.';
    const draftModule = await import('@/lib/client/anonymous-draft');
    const draft = draftModule.createAnonymousGenerationIntent({
      intentId,
      prompt,
      slideCount: 5,
      illustrationStyle: 'lab-notes',
      stage: 'submitted',
    });
    draftModule.saveAnonymousGenerationIntent(sessionStorage, draft);
    const fetchMock = vi.fn();
    const originalFetch = global.fetch;

    try {
      global.fetch = fetchMock as typeof fetch;
      const { DashboardHome } = await import('@/components/home/dashboard-home');
      render(React.createElement(DashboardHome, { resumeIntentId: intentId, resumeRequested: true }));

      await waitFor(() => {
        expect(screen.getByDisplayValue(prompt)).toBeTruthy();
        expect(screen.getByTestId('generate-access-dialog')).toBeTruthy();
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(draftModule.loadAnonymousGenerationIntent(sessionStorage, { intentId }))
        .toMatchObject({ stage: 'resuming' });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('pauses once for workspace choice when provisioning a workspace for a pending draft', async () => {
    workspaceData = {
      hasWorkspace: false,
      workspaceId: null,
      accessKeyPrefix: null,
      recoveryKey: null,
      generateAccessEnabled: false,
      hasGenerationAccess: false,
      generationAccessInvalidReason: null,
    };
    const intentId = '33333333-3333-4333-8333-333333333333';
    const draftModule = await import('@/lib/client/anonymous-draft');
    draftModule.saveAnonymousGenerationIntent(
      sessionStorage,
      draftModule.createAnonymousGenerationIntent({
        intentId,
        prompt: 'Compare stablecoin settlement rails for treasury teams.',
        slideCount: 3,
        illustrationStyle: 'pixel-art',
        stage: 'submitted',
      }),
    );
    createWorkspaceMutate.mockImplementation((_value, options) => {
      workspaceData = {
        hasWorkspace: true,
        workspaceId: 'workspace-account',
        accessKeyPrefix: 'acct_12345678',
        recoveryKey: null,
        workspaceOrigin: 'account',
        canReplaceWithLegacy: true,
        generateAccessEnabled: false,
        hasGenerationAccess: false,
        generationAccessInvalidReason: null,
      } as typeof workspaceData;
      options?.onSuccess?.({ success: true, workspaceId: 'workspace-account', created: true });
    });
    const fetchMock = vi.fn();
    const originalFetch = global.fetch;

    try {
      global.fetch = fetchMock as typeof fetch;
      const { DashboardHome } = await import('@/components/home/dashboard-home');
      render(React.createElement(DashboardHome, { resumeIntentId: intentId, resumeRequested: true }));

      expect(await screen.findByRole('button', { name: 'Continue with new workspace' })).toBeTruthy();
      expect(screen.getAllByRole('button', { name: 'Import old workspace' }).length).toBeGreaterThan(0);
      expect(screen.getByTestId('alert-dialog-cancel').textContent).toBe('Import old workspace');
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss mandatory choice' }));
      expect(screen.getByRole('button', { name: 'Continue with new workspace' })).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('requires an explicit continue after reloading an already-claimed draft', async () => {
    const intentId = '44444444-4444-4444-8444-444444444444';
    const prompt = 'Compare stablecoin settlement rails for treasury teams.';
    const draftModule = await import('@/lib/client/anonymous-draft');
    draftModule.saveAnonymousGenerationIntent(
      sessionStorage,
      draftModule.createAnonymousGenerationIntent({
        intentId,
        prompt,
        slideCount: 3,
        illustrationStyle: 'pixel-art',
        stage: 'resuming',
      }),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: intentId }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: intentId }), { status: 202 }));
    const originalFetch = global.fetch;

    try {
      global.fetch = fetchMock as typeof fetch;
      const { DashboardHome } = await import('@/components/home/dashboard-home');
      render(React.createElement(DashboardHome, { resumeIntentId: intentId, resumeRequested: true }));

      expect(await screen.findByDisplayValue(prompt)).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Continue this draft' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('does not provision a workspace for a malformed resume marker', async () => {
    workspaceData = {
      hasWorkspace: false,
      workspaceId: null,
      accessKeyPrefix: null,
      recoveryKey: null,
      generateAccessEnabled: false,
      hasGenerationAccess: false,
      generationAccessInvalidReason: null,
    };
    const { DashboardHome } = await import('@/components/home/dashboard-home');
    render(React.createElement(DashboardHome, { resumeIntentId: null, resumeRequested: true }));

    await waitFor(() => expect(screen.getByTestId('workspace-onboarding')).toBeTruthy());
    expect(createWorkspaceMutate).not.toHaveBeenCalled();
  });

  it('exports a quiet AI suggest frame helper for idle and non-idle states', async () => {
    const module = await import('@/components/home/dashboard-home');

    expect(typeof (module as any).getAiSuggestGlowClassName).toBe('function');

    const idleClassName = (module as any).getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: false });
    const suggestingClassName = (module as any).getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: true });
    const noTopicClassName = (module as any).getAiSuggestGlowClassName({ hasTopic: false, isSuggesting: false });

    expect(idleClassName).toContain('opacity-100');
    expect(idleClassName).toContain('border-primary/40');
    expect(idleClassName).not.toContain('gradient');

    expect(suggestingClassName).toContain('opacity-0');
    expect(suggestingClassName).not.toContain('ai-suggest-sweep');

    expect(noTopicClassName).toContain('opacity-0');
    expect(noTopicClassName).not.toContain('ai-suggest-sweep');
  });

  it('uses a structural border for the idle AI suggest state', async () => {
    const module = await import('@/components/home/dashboard-home');

    const className = (module as any).getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: false });

    expect(className).toContain('border');
    expect(className).toContain('border-primary/40');
    expect(className).not.toContain('bg-gradient');
  });

  it('exports a helper that requests an AI prompt suggestion from the existing prompt API', async () => {
    const module = await import('@/components/home/dashboard-home');

    expect(typeof (module as any).requestPromptSuggestion).toBe('function');

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ prompt: 'Generated article prompt' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const prompt = await (module as any).requestPromptSuggestion({
      title: 'Solana treasury strategy',
      fetchImpl,
    });

    expect(prompt).toBe('Generated article prompt');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/articles/generate-prompt',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ title: 'Solana treasury strategy' })
    );
  });

  it('exports a helper that runs the existing prompt article generation sequence', async () => {
    const module = await import('@/components/home/dashboard-home');

    expect(typeof (module as any).submitPromptArticle).toBe('function');

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'deck-123' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jobId: 'job-1', status: 'queued' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'job-1', status: 'completed', progress: 100 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const result = await (module as any).submitPromptArticle({
      title: 'Institutional stablecoin adoption',
      prompt: 'Write a strategic article for CFOs about stablecoin settlement.',
      fetchImpl,
    });

    expect(result).toEqual({ deckId: 'deck-123' });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      '/api/articles',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        title: 'Institutional stablecoin adoption',
        description: 'Write a strategic article for CFOs about stablecoin settlement.',
        content: 'Write a strategic article for CFOs about stablecoin settlement.',
        illustrationStyle: 'pixel-art',
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      '/api/articles/deck-123/generate',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchImpl.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({
        articleContent: 'Write a strategic article for CFOs about stablecoin settlement.',
        slideCount: 1,
        illustrationStyle: 'pixel-art',
        mode: 'prompt',
      })
    );
  });

  it('rejects a short prompt before creating an orphan article', async () => {
    const { submitPromptArticle } = await import('@/components/home/dashboard-home');
    const fetchImpl = vi.fn();

    await expect(submitPromptArticle({ prompt: 'Bitcoin', fetchImpl })).rejects.toThrow(
      /at least 10 characters/i,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('shows a localized short-prompt error without calling the article API', async () => {
    const fetchMock = vi.fn();
    const originalFetch = global.fetch;
    try {
      global.fetch = fetchMock as typeof fetch;
      const { DashboardHome } = await import('@/components/home/dashboard-home');
      render(React.createElement(DashboardHome));

      fireEvent.change(screen.getByPlaceholderText(messages.dashboard.promptPlaceholder), {
        target: { value: 'Bitcoin' },
      });
      fireEvent.click(screen.getByRole('button', { name: /generate article/i }));

      expect((await screen.findByRole('alert')).textContent).toContain(
        messages.publicHome.promptTooShort,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('moves an edited resumed draft to a durable independent checkpoint', async () => {
    const oldIntentId = '66666666-6666-4666-8666-666666666666';
    const newIntentId = '77777777-7777-4777-8777-777777777777';
    const newArticleId = '88888888-8888-4888-8888-888888888888';
    const oldPrompt = 'Compare stablecoin settlement rails for treasury teams.';
    const newPrompt = 'Compare tokenized treasury settlement rails for CFO teams.';
    const draftModule = await import('@/lib/client/anonymous-draft');
    draftModule.saveAnonymousGenerationIntent(
      sessionStorage,
      draftModule.createAnonymousGenerationIntent({
        intentId: oldIntentId,
        prompt: oldPrompt,
        slideCount: 3,
        illustrationStyle: 'pixel-art',
        stage: 'resuming',
      }),
    );
    window.history.replaceState(window.history.state, '', `/workspace?resume=${oldIntentId}`);
    const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(newIntentId);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: newArticleId }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 'GENERATE_ACCESS_REQUIRED',
        error: 'Generation access code required.',
      }), { status: 403 }));
    const originalFetch = global.fetch;

    try {
      global.fetch = fetchMock as typeof fetch;
      const { DashboardHome } = await import('@/components/home/dashboard-home');
      render(React.createElement(DashboardHome, {
        resumeIntentId: oldIntentId,
        resumeRequested: true,
      }));

      fireEvent.change(await screen.findByDisplayValue(oldPrompt), {
        target: { value: newPrompt },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Continue this draft' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
        'Idempotency-Key': newIntentId,
      });
      expect(draftModule.loadAnonymousGenerationIntent(sessionStorage)).toMatchObject({
        intentId: newIntentId,
        prompt: newPrompt,
        stage: 'article_created',
        articleId: newArticleId,
      });
      expect(window.location.search).toBe(`?resume=${newIntentId}`);
    } finally {
      global.fetch = originalFetch;
      randomUUID.mockRestore();
      window.history.replaceState(window.history.state, '', '/');
    }
  });

  it('uses localized account-menu labels', async () => {
    const { DashboardHome } = await import('@/components/home/dashboard-home');
    render(React.createElement(DashboardHome));

    expect(screen.getByText(messages.dashboard.connections)).toBeTruthy();
    expect(screen.getByText(messages.dashboard.signOut)).toBeTruthy();
  });

  it('uses the same idempotency key for article creation and generation', async () => {
    const { submitPromptArticle } = await import('@/components/home/dashboard-home');
    const idempotencyKey = '22222222-2222-4222-8222-222222222222';
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: idempotencyKey }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: idempotencyKey }), { status: 202 }));

    await submitPromptArticle({
      prompt: 'Write a strategic article about stablecoin settlement.',
      idempotencyKey,
      fetchImpl,
    });

    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toEqual({
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    });
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toEqual({
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    });
  });

  it('renders the prompt-first controls only when a workspace is attached', async () => {
    const { DashboardHome } = await import('@/components/home/dashboard-home');

    render(React.createElement(DashboardHome));

    expect(screen.getByRole('button', { name: /ai suggest/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /generate article/i })).toBeTruthy();

    const slidesTrigger = screen.getByRole('combobox', { name: /slides/i });
    const styleTrigger = screen.getByRole('combobox', { name: /style/i });

    expect(slidesTrigger.textContent).toContain('1');
    expect(styleTrigger.textContent).toContain('Pixel Art');
  });

  it('submits the selected slide count and illustration style through the existing generation flow', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'deck-456' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jobId: 'job-2', status: 'queued' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const originalFetch = global.fetch;

    try {
      global.fetch = fetchMock as typeof fetch;

      const module = await import('@/components/home/dashboard-home');

      render(React.createElement(module.DashboardHome));

      fireEvent.change(screen.getByPlaceholderText(messages.dashboard.promptPlaceholder), {
        target: { value: 'Create an article about treasury settlement using stablecoins.' },
      });

      fireEvent.click(screen.getByRole('combobox', { name: /slides/i }));
      fireEvent.click(await screen.findByRole('option', { name: '5' }));

      fireEvent.click(screen.getByRole('combobox', { name: /style/i }));
      fireEvent.click(await screen.findByRole('option', { name: /lab notes/i }));

      fireEvent.click(screen.getByRole('button', { name: /generate article/i }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });

      expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
        JSON.stringify({
          title: 'Create an article about treasury settlement using stablecoins.',
          description: 'Create an article about treasury settlement using stablecoins.',
          content: 'Create an article about treasury settlement using stablecoins.',
          illustrationStyle: 'lab-notes',
        })
      );
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(routerPush).toHaveBeenCalledWith('/articles/deck-456');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
