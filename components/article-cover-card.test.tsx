// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from './language-provider';
import { ArticleCoverCard } from './article-cover-card';

function EnglishLanguageProvider({ children }: React.PropsWithChildren) {
  return <LanguageProvider initialLanguage="en">{children}</LanguageProvider>;
}

function renderInEnglish(ui: React.ReactElement) {
  return render(ui, { wrapper: EnglishLanguageProvider });
}

describe('ArticleCoverCard', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('renders the English cover controls', () => {
    renderInEnglish(<ArticleCoverCard
      articleId="article_1"
      cover={null}
      isRetrying={false}
      onRetry={vi.fn()}
    />);

    expect(screen.getByRole('heading', { name: 'Article cover' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate cover' })).toBeTruthy();
  });

  it('previews the centered safe frame and offers regeneration', () => {
    const retry = vi.fn();
    renderInEnglish(<ArticleCoverCard
      articleId="article_1"
      isRetrying={false}
      onRetry={retry}
      cover={{
        id: 'cover_1', generationRevision: 2, style: 'binance-master', styleMode: 'scene',
        prompt: 'prompt', status: 'generated',
        imageUrl: 'r2://article-assets/asset_1/cover-source.png', error: null,
        createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
      }}
    />);
    expect((screen.getByAltText('Dedicated article cover safe-frame preview') as HTMLImageElement).src)
      .toContain('/api/articles/article_1/assets/cover-source.png');
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate cover' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('shows a recoverable failed state when no cover exists', () => {
    renderInEnglish(<ArticleCoverCard
      articleId="article_1"
      cover={null}
      isRetrying={false}
      onRetry={vi.fn()}
    />);
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate cover' })).toBeTruthy();
  });
});
