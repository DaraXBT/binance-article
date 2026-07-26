// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { DeckSlide } from '@/lib/schemas';
import { LanguageProvider } from './language-provider';
import { SlideList } from './slide-list';

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
    imageUrl: 'r2://article-assets/asset_1/old-slide.png',
    imageStatus: 'failed',
    imageError: 'Quota exceeded',
    imagePrompt: null,
    order: 0,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('SlideList image generation state', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('uses a lightweight spinner for a local retry target', () => {
    const { container } = render(
      <SlideList
        articleId="article_1"
        slides={[slide()]}
        activeSlideId="slide_1"
        onSelectSlide={() => undefined}
        generatingSlideIds={new Set(['slide_1'])}
      />,
      { wrapper: EnglishLanguageProvider },
    );

    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('also shows the spinner for backend-pending slides', () => {
    const { container } = render(
      <SlideList
        articleId="article_1"
        slides={[slide({ imageStatus: 'pending' })]}
        activeSlideId="slide_1"
        onSelectSlide={() => undefined}
      />,
      { wrapper: EnglishLanguageProvider },
    );

    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('keeps the existing thumbnail when the failed slide is not being retried', () => {
    render(
      <SlideList
        articleId="article_1"
        slides={[slide()]}
        activeSlideId="slide_1"
        onSelectSlide={() => undefined}
      />,
      { wrapper: EnglishLanguageProvider },
    );

    expect(screen.getByRole('img', { name: 'Market structure' })).toBeTruthy();
  });
});
