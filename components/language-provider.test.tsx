// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { LanguageProvider, useLanguage } from './language-provider';

function Probe() {
  const { language, messages, setLanguage } = useLanguage();
  return (
    <div>
      <output data-testid="language">{language}</output>
      <output data-testid="greeting">{messages.publicHome.studioGreeting}</output>
      <button type="button" onClick={() => setLanguage('km')}>Try Khmer</button>
    </div>
  );
}

describe('LanguageProvider', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.cookie = 'xarticle_language=; Max-Age=0; path=/';
    document.cookie = 'deckforge_language=; Max-Age=0; path=/';
  });

  it('ignores stale non-English browser preferences and keeps the UI English', async () => {
    // Legacy pre-rename keys must be normalized away, not just ignored.
    window.localStorage.setItem('deckforge_language', 'km');
    document.cookie = 'deckforge_language=km; path=/';

    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );

    expect(screen.getByTestId('language').textContent).toBe('en');
    expect(screen.getByTestId('greeting').textContent).toBe('What do you want to write about?');
    fireEvent.click(screen.getByRole('button', { name: 'Try Khmer' }));
    expect(screen.getByTestId('language').textContent).toBe('en');

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('en');
      expect(window.localStorage.getItem('xarticle_language')).toBe('en');
      expect(window.localStorage.getItem('deckforge_language')).toBeNull();
      expect(document.cookie).not.toContain('deckforge_language=km');
    });
  });
});
