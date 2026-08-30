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

type PublicationKind = 'post' | 'article';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestJson(options?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(options?.body ?? '{}')) as Record<string, unknown>;
}

function installPublicationFetch(
  drafts: Partial<Record<PublicationKind, Record<string, unknown>>> = {},
) {
  const fetchMock = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = requestUrl(input);
    const method = options?.method ?? 'GET';
    const parsedUrl = new URL(url, 'https://app.example.test');

    if (method === 'GET' && parsedUrl.pathname.endsWith('/publications/binance')) {
      const kind = parsedUrl.searchParams.get('kind') as PublicationKind | null;
      return jsonResponse({ draft: kind ? drafts[kind] ?? null : null });
    }

    if (method === 'PUT' && parsedUrl.pathname.endsWith('/publications/binance')) {
      const body = requestJson(options);
      return jsonResponse({
        draft: {
          id: `draft_binance_${String(body.kind)}`,
          articleId: 'deck-1',
          target: 'binance-square',
          ...body,
          revision: Number(body.expectedRevision ?? 0) + 1,
        },
      });
    }

    if (method === 'POST' && parsedUrl.pathname.endsWith('/publications/binance/prepare')) {
      const body = requestJson(options);
      return jsonResponse({
        command: {
          id: `command_binance_${String(body.kind)}`,
          draftId: `draft_binance_${String(body.kind)}`,
          target: 'binance-square',
          kind: body.kind,
          state: 'succeeded',
          revision: 1,
          recipeHash: 'b'.repeat(64),
          expiresAt: '2026-08-17T00:00:00.000Z',
        },
      });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('prefills an editable Binance article without automatically attaching generated media', () => {
    renderInEnglish(<BinanceExportDialog open onOpenChange={() => undefined} deck={deck} />);

    expect(screen.getByRole('heading', { name: 'Export to Binance Square' })).toBeTruthy();
    expect((screen.getByLabelText('Article title') as HTMLInputElement).value).toBe('Binance-ready title');
    expect((screen.getByLabelText('Article Markdown') as HTMLTextAreaElement).value).toContain('## Opening');
    expect(screen.getByAltText('Dedicated Binance cover preview')).toBeTruthy();
    expect((screen.getByLabelText('Use article cover') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Use Opening image') as HTMLInputElement).checked).toBe(false);
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

  it('prepares a media-free Article without inventing a cover', async () => {
    const fetchMock = installPublicationFetch();
    const withoutImages: DeckDetailResponse = {
      ...deck,
      cover: null,
      slides: deck.slides.map((slide) => ({ ...slide, imageUrl: null, imageStatus: 'failed' })),
    };

    renderInEnglish(<BinanceExportDialog open onOpenChange={() => undefined} deck={withoutImages} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/articles/deck-1/publications/binance?kind=article',
        expect.objectContaining({ cache: 'no-store' }),
      );
    });
    fireEvent.change(screen.getByLabelText('Article title'), {
      target: { value: 'A coverless Binance article' },
    });
    fireEvent.change(screen.getByLabelText('Article Markdown'), {
      target: { value: 'This article is complete without any media.' },
    });

    expect(screen.queryByText('Generate the dedicated 5:2 article cover before preparing Binance.'))
      .toBeNull();
    const prepare = screen.getByRole('button', { name: 'Prepare in Binance' });
    await waitFor(() => expect((prepare as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(prepare);

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(([input, options]) => (
        requestUrl(input).endsWith('/publications/binance') && options?.method === 'PUT'
      ));
      expect(saveCall).toBeTruthy();
      expect(requestJson(saveCall?.[1])).toEqual({
        kind: 'article',
        expectedRevision: 0,
        title: 'A coverless Binance article',
        markdown: 'This article is complete without any media.',
        orderedAssetIds: [],
      });
    });
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

  it('switches between independently loaded Article and Post drafts', async () => {
    const fetchMock = installPublicationFetch({
      article: {
        id: 'draft_binance_article', articleId: 'deck-1', target: 'binance-square',
        kind: 'article', revision: 4, title: 'Saved Binance article',
        markdown: 'Saved Binance article body.', orderedAssetIds: [],
      },
      post: {
        id: 'draft_binance_post', articleId: 'deck-1', target: 'binance-square',
        kind: 'post', revision: 6, text: 'Saved Binance post draft.', orderedAssetIds: [],
      },
    });
    renderInEnglish(<BinanceExportDialog open onOpenChange={vi.fn()} deck={deck} />);

    const postTab = screen.getByRole('tab', { name: 'Post' });
    const articleTab = screen.getByRole('tab', { name: 'Article' });
    expect(articleTab.getAttribute('aria-selected')).toBe('true');
    expect(postTab.getAttribute('aria-selected')).toBe('false');
    await waitFor(() => {
      expect((screen.getByLabelText('Article title') as HTMLInputElement).value)
        .toBe('Saved Binance article');
    });

    fireEvent.click(postTab);

    await waitFor(() => {
      expect((screen.getByLabelText('Binance post text') as HTMLTextAreaElement).value)
        .toBe('Saved Binance post draft.');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/articles/deck-1/publications/binance?kind=article',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/articles/deck-1/publications/binance?kind=post',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('prepares a text-only Post after clearing every selected image', async () => {
    const fetchMock = installPublicationFetch();
    renderInEnglish(<BinanceExportDialog open onOpenChange={vi.fn()} deck={deck} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Post' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/articles/deck-1/publications/binance?kind=post',
        expect.objectContaining({ cache: 'no-store' }),
      );
    });
    fireEvent.change(screen.getByLabelText('Binance post text'), {
      target: { value: 'A useful text-only Binance post.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear all media' }));
    expect(screen.getAllByRole('checkbox').every((checkbox) => !(checkbox as HTMLInputElement).checked))
      .toBe(true);

    const prepare = screen.getByRole('button', { name: 'Prepare in Binance' });
    await waitFor(() => expect((prepare as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(prepare);

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(([input, options]) => (
        requestUrl(input).endsWith('/publications/binance') && options?.method === 'PUT'
      ));
      expect(saveCall).toBeTruthy();
      expect(requestJson(saveCall?.[1])).toEqual({
        kind: 'post',
        expectedRevision: 0,
        text: 'A useful text-only Binance post.',
        orderedAssetIds: [],
      });
    });
    const prepareCall = fetchMock.mock.calls.find(([input, options]) => (
      requestUrl(input).endsWith('/publications/binance/prepare') && options?.method === 'POST'
    ));
    expect(requestJson(prepareCall?.[1])).toEqual({ kind: 'post', expectedRevision: 1 });
  });
});
