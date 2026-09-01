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

describe('LanguageProvider', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.cookie = 'xarticle_language=; Max-Age=0; path=/';
    document.cookie = 'deckforge_language=; Max-Age=0; path=/';
    document.documentElement.lang = 'en';
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
});
