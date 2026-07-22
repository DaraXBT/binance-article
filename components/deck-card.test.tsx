// @vitest-environment jsdom

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({
    language: 'en',
    messages: {
      deckCard: {
        status: { draft: 'Draft' },
        fallbackDescription: 'No description',
        slides: 'Slides',
        updated: 'Updated',
        created: 'Created',
        openDeck: 'Open article',
      },
    },
  }),
}));

vi.mock('@/lib/i18n', () => ({
  formatRelativeTime: () => 'just now',
}));

import { DeckCard } from './deck-card';

describe('DeckCard', () => {
  afterEach(() => cleanup());

  it('has no shadow, hover lift, or decorative gradient flare', () => {
    const { container } = render(
      <DeckCard
        id="article_1"
        title="Market update"
        slideCount={4}
        createdAt="2026-07-20T00:00:00.000Z"
        updatedAt="2026-07-21T00:00:00.000Z"
      />,
    );
    const card = container.querySelector('[data-slot="card"]');

    expect(card?.className).toContain('shadow-none');
    expect(card?.className).not.toContain('shadow-sm');
    expect(card?.className).not.toContain('shadow-[');
    expect(card?.className).not.toContain('hover:shadow');
    expect(card?.className).not.toContain('hover:-translate');
    expect(container.innerHTML).not.toContain('bg-gradient');
  });
});
