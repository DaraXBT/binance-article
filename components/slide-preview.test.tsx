// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeckSlide } from '@/lib/schemas';
import { LanguageProvider } from './language-provider';
import { SlidePreview } from './slide-preview';

vi.mock('@/components/image-generation-loader', () => ({
  ImageGenerationLoader: ({ label, detail }: { label: string; detail?: string }) => (
    <div data-testid="image-generation-loader">
      <span>{label}</span>
      {detail ? <span>{detail}</span> : null}
    </div>
  ),
}));

function EnglishLanguageProvider({ children }: React.PropsWithChildren) {
  return <LanguageProvider initialLanguage="en">{children}</LanguageProvider>;
}

function slide(overrides: Partial<DeckSlide> = {}): DeckSlide {
  return {
    id: 'slide_1',
    deckId: 'article_1',
    title: 'Market structure',
    subtitle: null,
    bullets: [],
    bulletPoints: [],
    notes: null,
    imageUrl: null,
    imageStatus: 'failed',
    imageError: 'Quota exceeded',
    imagePrompt: null,
    order: 0,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('SlidePreview image generation state', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('shows the generation loader while the backend status is pending', () => {
    render(
      <SlidePreview
        articleId="article_1"
        slide={slide({
          imageStatus: 'pending',
          imageUrl: 'r2://article-assets/asset_1/old-slide.png',
        })}
      />,
      { wrapper: EnglishLanguageProvider },
    );

    const loader = screen.getByTestId('image-generation-loader');
    expect(loader.textContent).toContain('Image generation is pending');
    expect(loader.textContent).toContain('Market structure');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the loader immediately when a failed slide is retried locally', () => {
    render(
      <SlidePreview articleId="article_1" slide={slide()} isGenerating />,
      { wrapper: EnglishLanguageProvider },
    );

    expect(screen.getByTestId('image-generation-loader')).toBeTruthy();
    expect(screen.queryByText('Quota exceeded')).toBeNull();
  });

  it('preserves the failed-image explanation outside a retry', () => {
    render(
      <SlidePreview articleId="article_1" slide={slide()} />,
      { wrapper: EnglishLanguageProvider },
    );

    expect(screen.queryByTestId('image-generation-loader')).toBeNull();
    expect(screen.getByText(/Quota exceeded/)).toBeTruthy();
  });
});
