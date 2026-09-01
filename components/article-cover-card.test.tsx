// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from './language-provider';
import { ArticleCoverCard } from './article-cover-card';

vi.mock('@/components/image-generation-loader', () => ({
  ImageGenerationLoader: ({
    label,
    backdrop,
    size,
  }: {
    label: string;
    backdrop?: React.ReactNode;
    size?: 'default' | 'compact';
  }) => (
    <div
      data-testid="image-generation-loader"
      data-size={size}
      data-has-backdrop={backdrop ? 'true' : 'false'}
    >
      {backdrop}
      <span>{label}</span>
    </div>
  ),
}));

function EnglishLanguageProvider({ children }: React.PropsWithChildren) {
  return <LanguageProvider initialLanguage="en">{children}</LanguageProvider>;
}

function renderInEnglish(ui: React.ReactElement) {
  return render(ui, { wrapper: EnglishLanguageProvider });
}

function ThaiLanguageProvider({ children }: React.PropsWithChildren) {
  return <LanguageProvider initialLanguage="th">{children}</LanguageProvider>;
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

  it('updates the cover UI from the selected interface language', () => {
    render(<ArticleCoverCard
      articleId="article_1"
      cover={null}
      isRetrying={false}
      onRetry={vi.fn()}
    />, { wrapper: ThaiLanguageProvider });

    expect(screen.getByRole('heading', { name: 'ภาพปกบทความ' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'สร้างภาพปก' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Generate cover' })).toBeNull();
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
      .toContain('/api/articles/article_1/assets/asset_1');
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

  it('uses the compact generation loader for a backend-pending cover', () => {
    renderInEnglish(<ArticleCoverCard
      articleId="article_1"
      cover={{
        id: 'cover_1', generationRevision: 1, style: 'binance-master', styleMode: 'scene',
        prompt: 'prompt', status: 'pending', imageUrl: null, error: null,
        createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
      }}
      isRetrying={false}
      onRetry={vi.fn()}
    />);

    const loader = screen.getByTestId('image-generation-loader');
    expect(loader.getAttribute('data-size')).toBe('compact');
    expect(loader.textContent).toContain('Generating');
    expect((screen.getByRole('button', { name: 'Generate cover' }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it('dims the existing cover behind the loader during local regeneration', () => {
    renderInEnglish(<ArticleCoverCard
      articleId="article_1"
      cover={{
        id: 'cover_1', generationRevision: 2, style: 'binance-master', styleMode: 'scene',
        prompt: 'prompt', status: 'generated',
        imageUrl: 'r2://article-assets/asset_1/cover-source.png', error: null,
        createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
      }}
      isRetrying
      onRetry={vi.fn()}
    />);

    const loader = screen.getByTestId('image-generation-loader');
    expect(loader.getAttribute('data-has-backdrop')).toBe('true');
    expect(loader.querySelector('img')?.src)
      .toContain('/api/articles/article_1/assets/asset_1');
  });
});
