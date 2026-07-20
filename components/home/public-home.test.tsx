// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const messages = {
  publicHome: {
    privateBeta: 'Invite-only private beta',
    signIn: 'Sign in',
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

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({ language: 'en', messages }),
}));
vi.mock('@/components/language-toggle', () => ({
  LanguageToggle: () => <button type="button">Language</button>,
}));
vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

import { PublicHome } from './public-home';

describe('PublicHome', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => cleanup());

  it('shows the public product home without calling a private API', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<PublicHome onNavigate={vi.fn()} />);

    expect(screen.getByRole('heading', { name: messages.publicHome.title })).toBeTruthy();
    expect(screen.getByRole('link', { name: messages.publicHome.signIn }).getAttribute('href'))
      .toBe('/login?callbackURL=%2Fworkspace');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('uses a quiet framed console without atmospheric decoration', () => {
    const { container } = render(<PublicHome onNavigate={vi.fn()} />);
    const composer = container.querySelector('#public-composer');
    const decoration = Array.from(
      composer?.querySelectorAll(':scope > [aria-hidden="true"]') ?? [],
    );

    expect(decoration).toHaveLength(0);
    expect(container.querySelector('[data-console-frame="public"]')).toBeTruthy();
    expect(container.querySelector('[data-console-status-rail]')).toBeTruthy();
  });

  it('keeps the public header utility controls compact', () => {
    const { container } = render(<PublicHome onNavigate={vi.fn()} />);
    const wordmark = screen.getByText('xArticle');
    const signIn = screen.getByRole('link', { name: messages.publicHome.signIn });
    const compactSignInLabel = signIn.querySelector('span');

    expect(container.querySelector('.console-header')).toBeTruthy();
    expect(wordmark.classList.contains('truncate')).toBe(true);
    expect(signIn.classList.contains('h-8')).toBe(true);
    expect(signIn.getAttribute('aria-label')).toBe(messages.publicHome.signIn);
    expect(compactSignInLabel?.classList.contains('hidden')).toBe(true);
    expect(compactSignInLabel?.classList.contains('min-[390px]:inline')).toBe(true);
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
    fireEvent.click(screen.getByRole('link', { name: messages.publicHome.signIn }));

    const stored = JSON.parse(
      sessionStorage.getItem('xarticle:anonymous-generation-intent:v1') ?? '{}',
    );
    expect(stored).toMatchObject({ stage: 'editing', prompt });
    expect(onNavigate).toHaveBeenCalledWith(
      `/login?callbackURL=${encodeURIComponent(`/workspace?resume=${stored.intentId}`)}`,
    );
  });
});
