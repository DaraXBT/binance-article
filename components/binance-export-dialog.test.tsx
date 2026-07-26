// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from './language-provider';
import { BinanceExportDialog } from './binance-export-dialog';
import type { DeckDetailResponse } from '@/lib/schemas';

function EnglishLanguageProvider({ children }: React.PropsWithChildren) {
  return <LanguageProvider initialLanguage="en">{children}</LanguageProvider>;
}

function renderInEnglish(ui: React.ReactElement) {
  return render(ui, { wrapper: EnglishLanguageProvider });
}

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
  cover: {
    id: 'cover-1',
    generationRevision: 1,
    style: 'binance-master',
    styleMode: 'scene',
    prompt: 'text-free cover',
    status: 'generated',
    imageUrl: 'r2://article-assets/cover_asset_1/cover-source.png',
    error: null,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  },
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

  it('prefills an editable Binance article and uses the dedicated generated cover', () => {
    renderInEnglish(<BinanceExportDialog open onOpenChange={() => undefined} deck={deck} />);

    expect(screen.getByRole('heading', { name: 'Export to Binance Square' })).toBeTruthy();
    expect((screen.getByLabelText('Article title') as HTMLInputElement).value).toBe('Binance-ready title');
    expect((screen.getByLabelText('Article Markdown') as HTMLTextAreaElement).value).toContain('## Opening');
    expect(screen.getByAltText('Dedicated Binance cover preview')).toBeTruthy();
    // Regression: a generated dedicated cover must never trip the cover
    // validation (its id is not a slide id).
    expect(screen.queryByText('Generate the dedicated 5:2 article cover before preparing Binance.')).toBeNull();
    expect(screen.getByText(/Slide 2 has no generated image/)).toBeTruthy();
    expect(screen.getByText(/Slide 2 uses slide content because its blog section is missing/)).toBeTruthy();
  });

  it('updates validation as the user edits the title and Markdown', () => {
    renderInEnglish(<BinanceExportDialog open onOpenChange={() => undefined} deck={deck} />);

    fireEvent.change(screen.getByLabelText('Article title'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Article Markdown'), { target: { value: '' } });

    expect(screen.getByText('A Binance article title is required.')).toBeTruthy();
    expect(screen.getByText('Article Markdown cannot be empty.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Download fallback ZIP' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('blocks export when no generated cover image is available', () => {
    const withoutImages: DeckDetailResponse = {
      ...deck,
      cover: null,
      slides: deck.slides.map((slide) => ({ ...slide, imageUrl: null, imageStatus: 'failed' })),
    };

    renderInEnglish(<BinanceExportDialog open onOpenChange={() => undefined} deck={withoutImages} />);

    expect(screen.getByText('Generate the dedicated 5:2 article cover before preparing Binance.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Download fallback ZIP' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps user edits when the polled deck object is replaced while open', () => {
    const { rerender } = renderInEnglish(
      <BinanceExportDialog open onOpenChange={() => undefined} deck={deck} />,
    );
    fireEvent.change(screen.getByLabelText('Article title'), {
      target: { value: 'Hand-edited title' },
    });
    fireEvent.change(screen.getByLabelText('Article Markdown'), {
      target: { value: '## Hand-edited body' },
    });

    rerender(
      <BinanceExportDialog
        open
        onOpenChange={() => undefined}
        deck={{ ...deck, slides: [...deck.slides] }}
      />,
    );

    expect((screen.getByLabelText('Article title') as HTMLInputElement).value)
      .toBe('Hand-edited title');
    expect((screen.getByLabelText('Article Markdown') as HTMLTextAreaElement).value)
      .toBe('## Hand-edited body');
  });

  it('surfaces a draft load failure, blocks prepare, and retries on demand', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('network down'); });
    vi.stubGlobal('fetch', fetchMock);
    try {
      renderInEnglish(<BinanceExportDialog open onOpenChange={() => undefined} deck={deck} />);

      await waitFor(() => {
        expect(screen.getByText('The Binance draft could not be loaded.')).toBeTruthy();
      });
      expect((screen.getByRole('button', { name: 'Prepare in Binance' }) as HTMLButtonElement).disabled)
        .toBe(true);

      const callsBefore = fetchMock.mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => {
        expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
