// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from './language-provider';
import type { DeckDetailResponse, DeckSlide } from '@/lib/schemas';
import { XExportDialog } from './x-export-dialog';

function EnglishLanguageProvider({ children }: React.PropsWithChildren) {
  return <LanguageProvider initialLanguage="en">{children}</LanguageProvider>;
}

function renderInEnglish(ui: React.ReactElement) {
  return render(ui, { wrapper: EnglishLanguageProvider });
}

type PublicationKind = 'post' | 'article';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
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

function installPublicationFetch({
  drafts = {},
  xArticlesUnavailable = false,
}: {
  drafts?: Partial<Record<PublicationKind, Record<string, unknown>>>;
  xArticlesUnavailable?: boolean;
} = {}) {
  const fetchMock = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = requestUrl(input);
    const method = options?.method ?? 'GET';
    const parsedUrl = new URL(url, 'https://app.example.test');

    if (method === 'GET' && parsedUrl.pathname.endsWith('/publications/x')) {
      const kind = parsedUrl.searchParams.get('kind') as PublicationKind | null;
      return jsonResponse({ draft: kind ? drafts[kind] ?? null : null });
    }

    if (method === 'PUT' && parsedUrl.pathname.endsWith('/publications/x')) {
      const body = requestJson(options);
      return jsonResponse({
        draft: {
          id: `draft_x_${String(body.kind)}`,
          articleId: 'deck-1',
          target: 'x',
          ...body,
          revision: Number(body.expectedRevision ?? 0) + 1,
        },
      });
    }

    if (method === 'POST' && parsedUrl.pathname.endsWith('/publications/x/prepare')) {
      const body = requestJson(options);
      if (xArticlesUnavailable && body.kind === 'article') {
        return jsonResponse({
          code: 'X_ARTICLES_UNAVAILABLE',
          error: 'X Articles are unavailable for this account.',
        }, 409);
      }
      return jsonResponse({
        command: {
          id: `command_x_${String(body.kind)}`,
          draftId: `draft_x_${String(body.kind)}`,
          target: 'x',
          kind: body.kind,
          state: 'succeeded',
          revision: 1,
          recipeHash: 'a'.repeat(64),
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

function slide(index: number): DeckSlide {
  return {
    id: `slide-${index}`,
    deckId: 'deck-1',
    title: `Slide ${index}`,
    subtitle: null,
    bullets: [],
    bulletPoints: [],
    notes: null,
    order: index - 1,
    imageUrl: `https://example.invalid/slide-${index}.png`,
    imageStatus: 'generated',
    imageError: null,
    imagePrompt: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  };
}

const deck: DeckDetailResponse = {
  id: 'deck-1',
  status: 'ready',
  title: 'X export',
  cover: null,
  slides: Array.from({ length: 5 }, (_, index) => slide(index + 1)),
  captions: {
    xSingle1: 'First generated X post.',
    xSingle2: 'Second generated X post.',
  },
};

describe('XExportDialog', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('prefills a generated caption and safely limits the default image selection to four', () => {
    renderInEnglish(<XExportDialog open onOpenChange={vi.fn()} deck={deck} />);

    expect(screen.getByRole('heading', { name: 'Prepare X post' })).toBeTruthy();
    expect((screen.getByLabelText('X post text') as HTMLTextAreaElement).value)
      .toBe('First generated X post.');
    expect((screen.getByLabelText('Use Slide 1 image') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Use Slide 4 image') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Use Slide 5 image') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Use Slide 5 image') as HTMLInputElement).disabled).toBe(true);
  });

  it('lets the user choose another generated caption without posting anything', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      renderInEnglish(<XExportDialog open onOpenChange={vi.fn()} deck={deck} />);
      fireEvent.click(screen.getByRole('button', { name: 'Use post 2' }));

      expect((screen.getByLabelText('X post text') as HTMLTextAreaElement).value)
        .toBe('Second generated X post.');
      expect(fetchSpy.mock.calls.every(([, options]) => !options || options.method === undefined)).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('blocks an empty bundle after all images are removed', () => {
    renderInEnglish(<XExportDialog open onOpenChange={vi.fn()} deck={{ ...deck, captions: null }} />);
    for (let index = 1; index <= 4; index += 1) {
      fireEvent.click(screen.getByLabelText(`Use Slide ${index} image`));
    }

    expect(screen.getByText('Add post text or select at least one image.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Download fallback ZIP' }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it('keeps user edits when the polled deck object is replaced while open', () => {
    const { rerender } = renderInEnglish(
      <XExportDialog open onOpenChange={vi.fn()} deck={deck} />,
    );
    fireEvent.change(screen.getByLabelText('X post text'), {
      target: { value: 'Hand-edited post text.' },
    });

    rerender(<XExportDialog open onOpenChange={vi.fn()} deck={{ ...deck, slides: [...deck.slides] }} />);

    expect((screen.getByLabelText('X post text') as HTMLTextAreaElement).value)
      .toBe('Hand-edited post text.');
  });

  it('surfaces a draft load failure, blocks prepare, and retries on demand', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('network down'); });
    vi.stubGlobal('fetch', fetchMock);
    try {
      renderInEnglish(<XExportDialog open onOpenChange={vi.fn()} deck={deck} />);

      await waitFor(() => {
        expect(screen.getByText('The X draft could not be loaded.')).toBeTruthy();
      });
      expect((screen.getByRole('button', { name: 'Prepare on X' }) as HTMLButtonElement).disabled)
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

  it('switches between independently loaded Post and Article drafts', async () => {
    const fetchMock = installPublicationFetch({
      drafts: {
        post: {
          id: 'draft_x_post', articleId: 'deck-1', target: 'x', kind: 'post', revision: 3,
          text: 'Saved X post draft.', orderedAssetIds: [],
        },
        article: {
          id: 'draft_x_article', articleId: 'deck-1', target: 'x', kind: 'article', revision: 7,
          title: 'Saved X article', markdown: 'Saved X article body.', orderedAssetIds: [],
        },
      },
    });

    renderInEnglish(<XExportDialog open onOpenChange={vi.fn()} deck={deck} />);

    const postTab = screen.getByRole('tab', { name: 'Post' });
    const articleTab = screen.getByRole('tab', { name: 'Article' });
    expect(postTab.getAttribute('aria-selected')).toBe('true');
    expect(articleTab.getAttribute('aria-selected')).toBe('false');
    await waitFor(() => {
      expect((screen.getByLabelText('X post text') as HTMLTextAreaElement).value)
        .toBe('Saved X post draft.');
    });

    fireEvent.click(articleTab);

    await waitFor(() => {
      expect((screen.getByLabelText('Article title') as HTMLInputElement).value)
        .toBe('Saved X article');
      expect((screen.getByLabelText('Article Markdown') as HTMLTextAreaElement).value)
        .toBe('Saved X article body.');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/articles/deck-1/publications/x?kind=post',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/articles/deck-1/publications/x?kind=article',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('prepares a text-only Post after clearing every selected image', async () => {
    const fetchMock = installPublicationFetch();
    renderInEnglish(<XExportDialog open onOpenChange={vi.fn()} deck={deck} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/articles/deck-1/publications/x?kind=post',
        expect.objectContaining({ cache: 'no-store' }),
      );
    });
    fireEvent.change(screen.getByLabelText('X post text'), {
      target: { value: 'A useful text-only X post.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear all media' }));
    expect(screen.getAllByRole('checkbox').every((checkbox) => !(checkbox as HTMLInputElement).checked))
      .toBe(true);

    const prepare = screen.getByRole('button', { name: 'Prepare on X' });
    await waitFor(() => expect((prepare as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(prepare);

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(([input, options]) => (
        requestUrl(input).endsWith('/publications/x') && options?.method === 'PUT'
      ));
      expect(saveCall).toBeTruthy();
      expect(requestJson(saveCall?.[1])).toEqual({
        kind: 'post',
        expectedRevision: 0,
        text: 'A useful text-only X post.',
        orderedAssetIds: [],
      });
    });
    const prepareCall = fetchMock.mock.calls.find(([input, options]) => (
      requestUrl(input).endsWith('/publications/x/prepare') && options?.method === 'POST'
    ));
    expect(requestJson(prepareCall?.[1])).toEqual({ kind: 'post', expectedRevision: 1 });
  });

  it('prepares a media-free Article without inventing a cover', async () => {
    const fetchMock = installPublicationFetch();
    const mediaFreeDeck: DeckDetailResponse = {
      ...deck,
      cover: null,
      slides: deck.slides.map((item) => ({
        ...item,
        imageUrl: null,
        imageStatus: 'failed',
      })),
    };
    renderInEnglish(<XExportDialog open onOpenChange={vi.fn()} deck={mediaFreeDeck} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Article' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/articles/deck-1/publications/x?kind=article',
        expect.objectContaining({ cache: 'no-store' }),
      );
    });
    fireEvent.change(screen.getByLabelText('Article title'), {
      target: { value: 'A coverless X article' },
    });
    fireEvent.change(screen.getByLabelText('Article Markdown'), {
      target: { value: 'This article is complete without any media.' },
    });

    const prepare = screen.getByRole('button', { name: 'Prepare on X' });
    await waitFor(() => expect((prepare as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(prepare);

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(([input, options]) => (
        requestUrl(input).endsWith('/publications/x') && options?.method === 'PUT'
      ));
      expect(saveCall).toBeTruthy();
      expect(requestJson(saveCall?.[1])).toEqual({
        kind: 'article',
        expectedRevision: 0,
        title: 'A coverless X article',
        markdown: 'This article is complete without any media.',
        orderedAssetIds: [],
      });
    });
  });

  it('makes the generated cover and body images optional for an Article', async () => {
    installPublicationFetch();
    renderInEnglish(<XExportDialog open onOpenChange={vi.fn()} deck={deck} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Article' }));

    const cover = await screen.findByLabelText('Use article cover');
    expect((cover as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole('button', { name: 'Clear all media' }));

    expect(screen.getAllByRole('checkbox').every((checkbox) => !(checkbox as HTMLInputElement).checked))
      .toBe(true);
  });

  it('explains unavailable X Articles without disabling regular X Posts', async () => {
    const fetchMock = installPublicationFetch({ xArticlesUnavailable: true });
    renderInEnglish(<XExportDialog open onOpenChange={vi.fn()} deck={deck} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Article' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/articles/deck-1/publications/x?kind=article',
        expect.objectContaining({ cache: 'no-store' }),
      );
    });
    fireEvent.change(screen.getByLabelText('Article title'), {
      target: { value: 'Eligible content, ineligible account' },
    });
    fireEvent.change(screen.getByLabelText('Article Markdown'), {
      target: { value: 'The account capability check happens at preparation time.' },
    });
    const prepare = screen.getByRole('button', { name: 'Prepare on X' });
    await waitFor(() => expect((prepare as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(prepare);

    expect(await screen.findByText('X Articles are unavailable for this account.')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Post' }));
    await waitFor(() => {
      expect(screen.queryByText('X Articles are unavailable for this account.')).toBeNull();
      expect((screen.getByRole('button', { name: 'Prepare on X' }) as HTMLButtonElement).disabled)
        .toBe(false);
    });
  });
});
