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
    expect(screen.getByRole('link', { name: messages.publicHome.signIn })).toHaveAttribute(
      'href',
      '/login?callbackURL=%2Fworkspace',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
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
    expect(screen.getByLabelText(messages.publicHome.promptLabel)).toHaveValue(prompt);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
