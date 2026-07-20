// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const messages = {
  publicHome: {
    privateBeta: 'Invite-only private beta',
    signIn: 'Sign in',
    studioTitle: 'Article Studio',
    eyebrow: 'Binance Square article studio',
    newArticle: 'New article',
    localDraft: 'Local draft',
    untitledArticle: 'Untitled article',
    draftStateLocal: 'LOCAL',
    draftStateHeld: 'HELD',
    draftStateReady: 'READY TO CONTINUE',
    savedInTab: 'Saved in this tab.',
    discardDraftTitle: 'Start a new article?',
    discardDraftDescription: 'Your current local draft will be cleared from this tab.',
    keepDraft: 'Keep draft',
    discardDraft: 'Discard draft',
    title: 'Turn a market idea into a publish-ready article.',
    subtitle: 'Draft the story, visuals, and social copy in one focused workspace.',
    promptLabel: 'Article idea',
    promptPlaceholder: 'Describe a crypto topic, thesis, or announcement…',
    createAction: 'Create article',
    slideCountLabel: 'Slides',
    illustrationStyleLabel: 'Style',
    accessHint: 'You’ll sign in and enter an article access code before AI generation starts.',
    localDraftHint: 'Saved in this tab until you sign in.',
    storageError: 'This browser could not preserve the draft.',
    retryDraft: 'Try saving the draft again',
    signInWithoutDraft: 'Sign in without this draft',
    resumeUnavailable: 'That draft is no longer available in this tab.',
    promptTooShort: 'Add at least 10 characters.',
    trustLine: 'Private assets · Binance login stays on your device',
    privateAssets: 'Private assets',
    startersLabel: 'Try an idea',
    starters: [
      'Explain tokenized gold for crypto traders',
      'Turn a protocol update into a launch article',
      'Compare the risks of liquid restaking',
    ],
  },
  newDeck: {
    styleOptions: {
      'pixel-art': { name: 'Pixel Art' },
      'fantasy-animation': { name: 'Fantasy Animation' },
      'lab-notes': { name: 'Lab Notes' },
    },
  },
};

const mobileState = vi.hoisted(() => ({ value: false }));

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({ language: 'en', messages }),
}));
vi.mock('@/components/language-toggle', () => ({
  LanguageToggle: () => <button type="button">Language</button>,
}));
vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mobileState.value,
}));

import { PublicHome } from './public-home';

describe('PublicHome', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mobileState.value = false;
  });
  afterEach(() => cleanup());

  it('shows the public product home without calling a private API', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<PublicHome onNavigate={vi.fn()} />);

    expect(screen.getByRole('heading', { name: messages.publicHome.title })).toBeTruthy();
    expect(
      screen.getAllByRole('link', { name: messages.publicHome.signIn })
        .some((link) => link.getAttribute('href') === '/login?callbackURL=%2Fworkspace'),
    ).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('keeps the public surface focused on the article composer', () => {
    render(<PublicHome onNavigate={vi.fn()} />);

    expect(screen.queryByText(messages.publicHome.accessHint)).toBeNull();
    expect(screen.queryByText(messages.publicHome.subtitle)).toBeNull();
    expect(screen.queryByText(messages.publicHome.eyebrow)).toBeNull();
    expect(screen.queryByText(messages.publicHome.trustLine)).toBeNull();
    expect(screen.queryByText(messages.publicHome.privateAssets)).toBeNull();
    expect(screen.queryByText(messages.publicHome.privateBeta)).toBeNull();
  });

  it('uses a quiet framed console without atmospheric decoration', () => {
    const { container } = render(<PublicHome onNavigate={vi.fn()} />);
    const composer = container.querySelector('#public-composer');
    const decoration = Array.from(
      composer?.querySelectorAll(':scope > [aria-hidden="true"]') ?? [],
    );

    expect(decoration).toHaveLength(0);
    expect(container.querySelector('[data-console-frame="public"]')).toBeTruthy();
    expect(container.querySelector('[data-console-status-rail]')).toBeNull();
  });

  it('keeps the public header utility controls compact', () => {
    const { container } = render(<PublicHome onNavigate={vi.fn()} />);
    const wordmark = screen.getByText('xArticle');
    const signIn = screen.getAllByRole('link', { name: messages.publicHome.signIn })
      .find((link) => link.classList.contains('h-8'));
    expect(signIn).toBeTruthy();
    const compactSignInLabel = signIn!.querySelector('span');

    expect(container.querySelector('.console-header')).toBeTruthy();
    expect(wordmark.classList.contains('truncate')).toBe(true);
    expect(signIn!.classList.contains('h-8')).toBe(true);
    expect(signIn!.getAttribute('aria-label')).toBe(messages.publicHome.signIn);
    expect(compactSignInLabel?.classList.contains('hidden')).toBe(true);
    expect(compactSignInLabel?.classList.contains('min-[390px]:inline')).toBe(true);
  });

  it('renders the compose-first Article Studio shell with an anonymous rail', () => {
    const { container } = render(<PublicHome onNavigate={vi.fn()} />);

    expect(container.querySelector('[data-article-studio-shell="public"]')).toBeTruthy();
    expect(container.querySelector('[data-article-studio-rail]')).toBeTruthy();
    expect(container.querySelector('[data-article-studio-composer]')).toBeTruthy();
    expect(container.querySelector('[data-article-studio-status-strip]')).toBeNull();
    expect(screen.getByRole('navigation', { name: /article/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: messages.publicHome.newArticle })).toBeTruthy();
    expect(screen.getByText(/saved in this tab/i)).toBeTruthy();
  });

  it('restores one local draft into the anonymous rail without exposing prompt text in a URL', () => {
    const now = Date.now();
    const prompt = 'Explain tokenized gold settlement for crypto traders.';
    const title = 'Explain tokenized gold settlement';
    sessionStorage.setItem(
      'xarticle:anonymous-generation-intent:v1',
      JSON.stringify({
        version: 1,
        intentId: '99999999-9999-4999-8999-999999999999',
        action: 'generate',
        stage: 'editing',
        prompt,
        slideCount: 5,
        illustrationStyle: 'lab-notes',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 60 * 60 * 1_000,
      }),
    );

    const { container } = render(<PublicHome onNavigate={vi.fn()} />);
    const rail = container.querySelector('[data-article-studio-rail]');

    expect(rail).toBeTruthy();
    expect(screen.getByDisplayValue(prompt)).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(title, 'i') })).toBeTruthy();
    expect(rail?.textContent).toContain(messages.publicHome.draftStateHeld);
    expect(rail?.querySelector(`a[href*="${prompt}"]`)).toBeNull();
  });

  it('marks a submitted draft as ready to continue instead of presenting it as a generic held draft', () => {
    const now = Date.now();
    const prompt = 'Explain tokenized gold settlement for crypto traders.';
    sessionStorage.setItem(
      'xarticle:anonymous-generation-intent:v1',
      JSON.stringify({
        version: 1,
        intentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        action: 'generate',
        stage: 'submitted',
        prompt,
        slideCount: 5,
        illustrationStyle: 'lab-notes',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 60 * 60 * 1_000,
      }),
    );

    const { container } = render(<PublicHome onNavigate={vi.fn()} />);
    const rail = container.querySelector('[data-article-studio-rail]');

    expect(rail?.textContent).toContain(messages.publicHome.draftStateReady);
    expect(rail?.textContent).not.toContain(messages.publicHome.draftStateHeld);
  });

  it('selects a starter idea, focuses the composer, and makes no network request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      render(<PublicHome onNavigate={vi.fn()} />);

      const starter = messages.publicHome.starters[0];
      fireEvent.click(screen.getByRole('button', { name: starter }));

      const prompt = screen.getByLabelText(messages.publicHome.promptLabel) as HTMLTextAreaElement;
      expect(prompt.value).toBe(starter);
      expect(document.activeElement).toBe(prompt);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('closes the mobile rail after selecting a starter idea and returns focus to the composer', async () => {
    mobileState.value = true;
    render(<PublicHome onNavigate={vi.fn()} />);

    const trigger = document.querySelector('[data-sidebar="trigger"]');
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger!);

    const starter = messages.publicHome.starters[0];
    expect(screen.getByRole('button', { name: starter })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: starter }));

    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: starter })).toBeNull();
    });
    expect(document.activeElement).toBe(
      screen.getByLabelText(messages.publicHome.promptLabel),
    );
  });

  it('requires confirmation before clearing a non-empty local draft and preserves it on cancel', () => {
    const prompt = 'Explain tokenized gold settlement for crypto traders.';
    render(<PublicHome onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(messages.publicHome.promptLabel), {
      target: { value: prompt },
    });

    fireEvent.click(screen.getByRole('button', { name: messages.publicHome.newArticle }));
    expect(screen.getByRole('heading', { name: messages.publicHome.discardDraftTitle })).toBeTruthy();
    expect(screen.getByText(messages.publicHome.discardDraftDescription)).toBeTruthy();
    expect((screen.getByLabelText(messages.publicHome.promptLabel) as HTMLTextAreaElement).value)
      .toBe(prompt);

    fireEvent.click(screen.getByRole('button', { name: messages.publicHome.keepDraft }));
    expect(screen.queryByRole('heading', { name: messages.publicHome.discardDraftTitle })).toBeNull();
    expect((screen.getByLabelText(messages.publicHome.promptLabel) as HTMLTextAreaElement).value)
      .toBe(prompt);
  });

  it('clears the local draft only after confirming New article and keeps style preferences', () => {
    const now = Date.now();
    const prompt = 'Explain tokenized gold settlement for crypto traders.';
    sessionStorage.setItem(
      'xarticle:anonymous-generation-intent:v1',
      JSON.stringify({
        version: 1,
        intentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        action: 'generate',
        stage: 'editing',
        prompt,
        slideCount: 7,
        illustrationStyle: 'fantasy-animation',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 60 * 60 * 1_000,
      }),
    );
    render(<PublicHome onNavigate={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: messages.publicHome.newArticle }));
    fireEvent.click(screen.getByRole('button', { name: messages.publicHome.discardDraft }));

    expect((screen.getByLabelText(messages.publicHome.promptLabel) as HTMLTextAreaElement).value)
      .toBe('');
    expect(sessionStorage.getItem('xarticle:anonymous-generation-intent:v1')).toBeNull();
    expect(screen.getByRole('combobox', { name: messages.publicHome.slideCountLabel }).textContent)
      .toContain('7');
    expect(screen.getByRole('combobox', {
      name: messages.publicHome.illustrationStyleLabel,
    }).textContent).toContain('Fantasy Animation');
    expect(screen.getByRole('button', { name: messages.publicHome.newArticle })).toBeTruthy();
  });

  it('shows a visible keyboard focus ring on the prompt field', () => {
    render(<PublicHome onNavigate={vi.fn()} />);
    const prompt = screen.getByLabelText(messages.publicHome.promptLabel);

    expect(prompt.classList.contains('focus-visible:ring-0')).toBe(false);
    expect(prompt.classList.contains('focus-visible:ring-[3px]')).toBe(true);
    expect((prompt as HTMLTextAreaElement).minLength).toBe(10);
  });

  it('persists the latest valid prompt synchronously and navigates with only an opaque resume id', () => {
    const onNavigate = vi.fn();
    render(<PublicHome onNavigate={onNavigate} />);
    fireEvent.change(screen.getByLabelText(messages.publicHome.promptLabel), {
      target: { value: 'Explain tokenized gold settlement for crypto traders.' },
    });
    fireEvent.click(screen.getByRole('button', { name: messages.publicHome.createAction }));

    const stored = JSON.parse(
      sessionStorage.getItem('xarticle:anonymous-generation-intent:v1') ?? '{}',
    );
    expect(stored).toMatchObject({
      stage: 'submitted',
      prompt: 'Explain tokenized gold settlement for crypto traders.',
    });
    expect(onNavigate).toHaveBeenCalledWith(`/workspace?resume=${stored.intentId}`);
    expect(onNavigate.mock.calls[0]?.[0]).not.toContain('tokenized');
  });

  it('keeps the prompt visible and explains the problem when tab storage is denied', () => {
    const deniedStorage = {
      getItem: () => null,
      setItem: () => { throw new DOMException('Denied', 'SecurityError'); },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } satisfies Storage;
    const onNavigate = vi.fn();
    render(<PublicHome onNavigate={onNavigate} storage={deniedStorage} />);
    const prompt = 'Explain tokenized gold settlement for crypto traders.';
    fireEvent.change(screen.getByLabelText(messages.publicHome.promptLabel), {
      target: { value: prompt },
    });
    fireEvent.click(screen.getByRole('button', { name: messages.publicHome.createAction }));

    expect(screen.getByRole('alert').textContent).toContain(messages.publicHome.storageError);
    expect((screen.getByLabelText(messages.publicHome.promptLabel) as HTMLTextAreaElement).value)
      .toBe(prompt);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('does not let a delayed autosave undo a submitted intent', () => {
    vi.useFakeTimers();
    try {
      const onNavigate = vi.fn();
      render(<PublicHome onNavigate={onNavigate} />);
      fireEvent.change(screen.getByLabelText(messages.publicHome.promptLabel), {
        target: { value: 'Explain tokenized gold settlement for crypto traders.' },
      });
      fireEvent.click(screen.getByRole('button', { name: messages.publicHome.createAction }));
      vi.runOnlyPendingTimers();

      const stored = JSON.parse(
        sessionStorage.getItem('xarticle:anonymous-generation-intent:v1') ?? '{}',
      );
      expect(stored.stage).toBe('submitted');
      expect(onNavigate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a previously submitted intent submitted until the user edits it', () => {
    vi.useFakeTimers();
    try {
      const intentId = '55555555-5555-4555-8555-555555555555';
      const now = Date.now();
      sessionStorage.setItem('xarticle:anonymous-generation-intent:v1', JSON.stringify({
        version: 1,
        intentId,
        action: 'generate',
        stage: 'submitted',
        prompt: 'Explain tokenized gold settlement for crypto traders.',
        slideCount: 5,
        illustrationStyle: 'lab-notes',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 60 * 60 * 1_000,
      }));
      render(<PublicHome onNavigate={vi.fn()} />);
      vi.runOnlyPendingTimers();

      const stored = JSON.parse(
        sessionStorage.getItem('xarticle:anonymous-generation-intent:v1') ?? '{}',
      );
      expect(stored.stage).toBe('submitted');
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes the latest draft before an immediate header sign-in', () => {
    const onNavigate = vi.fn();
    const prompt = 'Explain tokenized gold settlement for crypto traders.';
    render(<PublicHome onNavigate={onNavigate} />);
    fireEvent.change(screen.getByLabelText(messages.publicHome.promptLabel), {
      target: { value: prompt },
    });
    const headerSignIn = screen.getAllByRole('link', { name: messages.publicHome.signIn })
      .find((link) => link.classList.contains('h-8'));
    expect(headerSignIn).toBeTruthy();
    fireEvent.click(headerSignIn!);

    const stored = JSON.parse(
      sessionStorage.getItem('xarticle:anonymous-generation-intent:v1') ?? '{}',
    );
    expect(stored).toMatchObject({ stage: 'editing', prompt });
    expect(onNavigate).toHaveBeenCalledWith(
      `/login?callbackURL=${encodeURIComponent(`/workspace?resume=${stored.intentId}`)}`,
    );
  });
});
