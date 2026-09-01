// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { LanguageProvider, useLanguage } from './language-provider';
import type { Language } from '@/lib/i18n';

function Probe() {
  const { language, messages, setLanguage } = useLanguage();
  return (
    <div>
      <output data-testid="language">{language}</output>
      <output data-testid="greeting">{messages.publicHome.studioGreeting}</output>
      <button type="button" onClick={() => setLanguage('km')}>Switch to Khmer</button>
    </div>
  );
}

function DraftAndDialogProbe() {
  const { messages, setLanguage } = useLanguage();
  const [draft, setDraft] = React.useState('');
  const [dialogOpen, setDialogOpen] = React.useState(false);

  return (
    <div>
      <input
        aria-label="Draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="button" onClick={() => setDialogOpen(true)}>Open settings</button>
      <button type="button" onClick={() => setLanguage('km')}>Switch to Khmer</button>
      {dialogOpen ? <div role="dialog">{messages.dashboard.settings}</div> : null}
    </div>
  );
}

describe('LanguageProvider', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.cookie = 'xarticle_language=; Max-Age=0; path=/';
    document.cookie = 'deckforge_language=; Max-Age=0; path=/';
    document.documentElement.lang = 'en';
    document.title = '';
  });

  it('uses the server-provided locale instead of a stale browser preference', async () => {
    window.localStorage.setItem('xarticle_language', 'th');
    window.localStorage.setItem('deckforge_language', 'th');
    document.cookie = 'deckforge_language=th; path=/';

    render(
      <LanguageProvider initialLanguage="km">
        <Probe />
      </LanguageProvider>,
    );

    expect(screen.getByTestId('language').textContent).toBe('km');
    expect(screen.getByTestId('greeting').textContent).toBe('តើអ្នកចង់សរសេរអំពីអ្វី?');

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('km');
      expect(window.localStorage.getItem('xarticle_language')).toBe('km');
      expect(window.localStorage.getItem('deckforge_language')).toBeNull();
      expect(document.cookie).not.toContain('deckforge_language=');
    });
  });

  it('updates messages immediately and persists the new locale for the next server render', async () => {
    const { unmount } = render(
      <LanguageProvider initialLanguage="en">
        <Probe />
      </LanguageProvider>,
    );

    expect(screen.getByTestId('greeting').textContent).toBe('What do you want to write about?');

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Khmer' }));

    expect(screen.getByTestId('language').textContent).toBe('km');
    expect(screen.getByTestId('greeting').textContent).toBe('តើអ្នកចង់សរសេរអំពីអ្វី?');

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('km');
      expect(window.localStorage.getItem('xarticle_language')).toBe('km');
      expect(document.cookie).toContain('xarticle_language=km');
      expect(document.title).toBe('xArticle — ស្ទូឌីយោអត្ថបទ Binance Square');
    });

    unmount();
    render(
      <LanguageProvider initialLanguage="km">
        <Probe />
      </LanguageProvider>,
    );

    expect(screen.getByTestId('language').textContent).toBe('km');
    expect(screen.getByTestId('greeting').textContent).toBe('តើអ្នកចង់សរសេរអំពីអ្វី?');
  });

  it('safely falls back to English for an invalid server locale', () => {
    render(
      <LanguageProvider initialLanguage={'unsupported' as Language}>
        <Probe />
      </LanguageProvider>,
    );

    expect(screen.getByTestId('language').textContent).toBe('en');
    expect(screen.getByTestId('greeting').textContent).toBe('What do you want to write about?');
  });

  it('keeps active draft and dialog state when switching language', () => {
    render(
      <LanguageProvider initialLanguage="en">
        <DraftAndDialogProbe />
      </LanguageProvider>,
    );

    const draft = screen.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement;
    fireEvent.change(draft, { target: { value: 'Keep this working draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Khmer' }));

    expect(draft.value).toBe('Keep this working draft');
    expect(screen.getByRole('dialog').textContent).toBe('ការកំណត់');
  });
});
