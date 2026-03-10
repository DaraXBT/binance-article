// @vitest-environment jsdom

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const messages = {
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
  AlertDialog: ({ children }: any) => React.createElement(React.Fragment, null, children),
  AlertDialogAction: ({ children, ...props }: any) => React.createElement('button', props, children),
  AlertDialogCancel: ({ children, ...props }: any) => React.createElement('button', props, children),
  AlertDialogContent: ({ children }: any) => React.createElement('div', null, children),
  AlertDialogDescription: ({ children }: any) => React.createElement('p', null, children),
  AlertDialogFooter: ({ children }: any) => React.createElement('div', null, children),
  AlertDialogHeader: ({ children }: any) => React.createElement('div', null, children),
  AlertDialogTitle: ({ children }: any) => React.createElement('h2', null, children),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => React.createElement(React.Fragment, null, children),
  DropdownMenuContent: ({ children }: any) => React.createElement('div', null, children),
  DropdownMenuItem: ({ children, ...props }: any) => React.createElement('button', props, children),
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

const refetch = vi.fn();
const mutate = vi.fn();
let workspaceData:
  | {
      hasWorkspace: boolean;
      workspaceId: string | null;
      accessKeyPrefix: string | null;
      recoveryKey: string | null;
    }
  | undefined = {
  hasWorkspace: true,
  workspaceId: 'workspace-1',
  accessKeyPrefix: 'dwk_test',
  recoveryKey: null,
};
let workspaceIsLoading = false;

vi.mock('@/lib/hooks', () => ({
  useDecks: () => ({ data: [], isLoading: false, isError: false, refetch }),
  useWorkspace: () => ({ data: workspaceData, isLoading: workspaceIsLoading }),
  useUpdateDeck: () => ({ isPending: false, mutate }),
  useDeleteDeck: () => ({ isPending: false, mutate }),
}));

describe('DashboardHome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    workspaceData = {
      hasWorkspace: true,
      workspaceId: 'workspace-1',
      accessKeyPrefix: 'dwk_test',
      recoveryKey: null,
    };
    workspaceIsLoading = false;
  });

  afterEach(() => {
    cleanup();
    routerPush.mockReset();
    refetch.mockReset();
    vi.resetAllMocks();
  });

  it('does not show onboarding while workspace status is still loading', async () => {
    workspaceData = undefined;
    workspaceIsLoading = true;

    const { DashboardHome } = await import('@/components/home/dashboard-home');
    const html = renderToStaticMarkup(React.createElement(DashboardHome));

    expect(html).not.toContain('data-testid="workspace-onboarding"');
    expect(html).not.toContain(messages.dashboard.promptHomeTitle);
  });

  it('shows workspace onboarding instead of the dashboard when no workspace is attached', async () => {
    workspaceData = {
      hasWorkspace: false,
      workspaceId: null,
      accessKeyPrefix: null,
      recoveryKey: null,
    };

    const { DashboardHome } = await import('@/components/home/dashboard-home');
    const html = renderToStaticMarkup(React.createElement(DashboardHome));

    expect(html).toContain('data-testid="workspace-onboarding"');
    expect(html).toContain(messages.workspace.onboardingTitle);
    expect(html).not.toContain(messages.dashboard.promptHomeTitle);
  });

  it('renders a prompt-first home composer after a workspace is attached', async () => {
    const { DashboardHome } = await import('@/components/home/dashboard-home');

    const html = renderToStaticMarkup(React.createElement(DashboardHome));

    expect(html).toContain(messages.dashboard.promptHomeTitle);
    expect(html).toContain(messages.dashboard.topicPlaceholder);
    expect(html).toContain(messages.dashboard.aiSuggest);
    expect(html).toContain('ai-suggest-glow');
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

  it('exports a helper that returns the AI suggest glow classes for idle and non-idle states', async () => {
    const module = await import('@/components/home/dashboard-home');

    expect(typeof (module as any).getAiSuggestGlowClassName).toBe('function');

    const idleClassName = (module as any).getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: false });
    const suggestingClassName = (module as any).getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: true });
    const noTopicClassName = (module as any).getAiSuggestGlowClassName({ hasTopic: false, isSuggesting: false });

    expect(idleClassName).toContain('opacity-100');
    expect(idleClassName).toContain('motion-safe:animate-[ai-suggest-sweep');

    expect(suggestingClassName).toContain('opacity-0');
    expect(suggestingClassName).not.toContain('motion-safe:animate-[ai-suggest-glow');
    expect(suggestingClassName).not.toContain('ai-suggest-sweep');

    expect(noTopicClassName).toContain('opacity-0');
    expect(noTopicClassName).not.toContain('motion-safe:animate-[ai-suggest-glow');
    expect(noTopicClassName).not.toContain('ai-suggest-sweep');
  });

  it('uses warm gradient glow classes for the idle AI suggest state', async () => {
    const module = await import('@/components/home/dashboard-home');

    const className = (module as any).getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: false });

    expect(className).toContain('from-yellow-400/20');
    expect(className).toContain('via-amber-400/90');
    expect(className).toContain('to-orange-400/25');
    expect(className).toContain('[background-size:200%_100%]');
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
        new Response(JSON.stringify({ success: true, slideCount: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'success', generated: 1, failed: 0, total: 1 }), {
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
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      '/api/articles/deck-123/generate-images',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchImpl.mock.calls[2]?.[1]?.body).toBe(
      JSON.stringify({ illustrationStyle: 'pixel-art' })
    );
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
        new Response(JSON.stringify({ success: true, slideCount: 5 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'success', generated: 5, failed: 0, total: 5 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const originalFetch = global.fetch;

    try {
      global.fetch = fetchMock as typeof fetch;

      const module = await import('@/components/home/dashboard-home');

      render(React.createElement(module.DashboardHome));

      fireEvent.change(screen.getByPlaceholderText(messages.dashboard.topicPlaceholder), {
        target: { value: 'Stablecoin treasury operations' },
      });
      fireEvent.change(screen.getByPlaceholderText(messages.dashboard.promptPlaceholder), {
        target: { value: 'Create an article about treasury settlement using stablecoins.' },
      });

      fireEvent.click(screen.getByRole('combobox', { name: /slides/i }));
      fireEvent.click(await screen.findByRole('option', { name: '5' }));

      fireEvent.click(screen.getByRole('combobox', { name: /style/i }));
      fireEvent.click(await screen.findByRole('option', { name: /lab notes/i }));

      fireEvent.click(screen.getByRole('button', { name: /generate article/i }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(3);
      });

      expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
        JSON.stringify({
          articleContent: 'Create an article about treasury settlement using stablecoins.',
          slideCount: 5,
          illustrationStyle: 'lab-notes',
          mode: 'prompt',
        })
      );
      expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(
        JSON.stringify({ illustrationStyle: 'lab-notes' })
      );
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(routerPush).toHaveBeenCalledWith('/articles/deck-456');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
