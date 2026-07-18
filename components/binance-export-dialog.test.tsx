// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BinanceExportDialog } from './binance-export-dialog';
import type { DeckDetailResponse } from '@/lib/schemas';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: React.PropsWithChildren<{ open: boolean }>) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogDescription: ({ children }: React.PropsWithChildren) => <p>{children}</p>,
  DialogFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>,
}));

const deck: DeckDetailResponse = {
  id: 'deck-1',
  status: 'ready',
  title: 'Fallback title',
  slides: [
    {
      id: 'slide-1', deckId: 'deck-1', title: 'Opening', subtitle: null,
      bullets: [], bulletPoints: [], notes: null, order: 0,
      imageUrl: 'https://example.public.blob.vercel-storage.com/slide-1.png',
      imageStatus: 'generated', imageError: null, imagePrompt: null,
      createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z',
    },
    {
      id: 'slide-2', deckId: 'deck-1', title: 'Closing', subtitle: 'Fallback copy',
      bullets: ['One'], bulletPoints: ['One'], notes: null, order: 1,
      imageUrl: null, imageStatus: 'failed', imageError: 'quota', imagePrompt: null,
      createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z',
    },
  ],
  captions: {
    blogTitle: 'Binance-ready title',
    blogIntro: 'Generated introduction.',
    blogSections: ['Opening section.'],
    blogTags: ['BTC', 'web 3'],
  },
};

describe('BinanceExportDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('prefills an editable Binance article and selects the first generated image as cover', () => {
    render(<BinanceExportDialog open onOpenChange={() => undefined} deck={deck} />);

    expect(screen.getByRole('heading', { name: 'Export to Binance Square' })).toBeTruthy();
    expect((screen.getByLabelText('Article title') as HTMLInputElement).value).toBe('Binance-ready title');
    expect((screen.getByLabelText('Article Markdown') as HTMLTextAreaElement).value).toContain('## Opening');
    expect((screen.getByLabelText('Use Opening as cover') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Slide 2 has no generated image/)).toBeTruthy();
    expect(screen.getByText(/Slide 2 uses slide content because its blog section is missing/)).toBeTruthy();
  });

  it('updates validation as the user edits the title and Markdown', () => {
    render(<BinanceExportDialog open onOpenChange={() => undefined} deck={deck} />);

    fireEvent.change(screen.getByLabelText('Article title'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Article Markdown'), { target: { value: '' } });

    expect(screen.getByText('A Binance article title is required.')).toBeTruthy();
    expect(screen.getByText('Article Markdown cannot be empty.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Download Binance bundle' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('blocks export when no generated cover image is available', () => {
    const withoutImages: DeckDetailResponse = {
      ...deck,
      slides: deck.slides.map((slide) => ({ ...slide, imageUrl: null, imageStatus: 'failed' })),
    };

    render(<BinanceExportDialog open onOpenChange={() => undefined} deck={withoutImages} />);

    expect(screen.getByText('Choose a generated slide image for the 5:2 cover.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Download Binance bundle' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
