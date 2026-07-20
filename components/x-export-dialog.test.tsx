// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeckDetailResponse, DeckSlide } from '@/lib/schemas';
import { XExportDialog } from './x-export-dialog';

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
  slides: Array.from({ length: 5 }, (_, index) => slide(index + 1)),
  captions: {
    xSingle1: 'First generated X post.',
    xSingle2: 'Second generated X post.',
  },
};

describe('XExportDialog', () => {
  afterEach(() => cleanup());

  it('prefills a generated caption and safely limits the default image selection to four', () => {
    render(<XExportDialog open onOpenChange={vi.fn()} deck={deck} />);

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
      render(<XExportDialog open onOpenChange={vi.fn()} deck={deck} />);
      fireEvent.click(screen.getByRole('button', { name: 'Use post 2' }));

      expect((screen.getByLabelText('X post text') as HTMLTextAreaElement).value)
        .toBe('Second generated X post.');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('blocks an empty bundle after all images are removed', () => {
    render(<XExportDialog open onOpenChange={vi.fn()} deck={{ ...deck, captions: null }} />);
    for (let index = 1; index <= 4; index += 1) {
      fireEvent.click(screen.getByLabelText(`Use Slide ${index} image`));
    }

    expect(screen.getByText('Add post text or select at least one image.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Download X post bundle' }) as HTMLButtonElement).disabled)
      .toBe(true);
  });
});
