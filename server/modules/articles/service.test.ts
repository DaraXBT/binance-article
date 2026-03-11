import { describe, it, expect, vi, beforeEach } from 'vitest';

const { txMock, prismaMock } = vi.hoisted(() => {
  const tx = {
    deckProject: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    slide: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    captionPackage: {
      upsert: vi.fn(),
    },
  };

  return {
    txMock: tx,
    prismaMock: {
      $transaction: vi.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
      deckProject: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        findMany: vi.fn(),
      },
      slide: {
        deleteMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
      captionPackage: {
        upsert: vi.fn(),
        findUnique: vi.fn(),
      },
      renderAsset: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
      jobRun: {
        findFirst: vi.fn(),
      },
    },
  };
});

vi.mock('@/server/integrations/prisma', () => ({ default: prismaMock }));

import {
  replaceGeneratedContent,
  beginGenerationRevision,
  parseRevisionNumber,
} from './service';
import type { GeneratedDeckResponse } from '@/lib/gemini';

function fakeDeck(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deck-1',
    workspaceId: 'ws-1',
    title: 'Test Article',
    description: null,
    content: 'Some content',
    theme: 'default',
    customTheme: null,
    illustrationStyle: 'pixel-art',
    status: 'draft',
    generationRevision: 1,
    lastCompletedRevision: 0,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    captions: null,
    ...overrides,
  };
}

function fakeGenerated(): GeneratedDeckResponse {
  return {
    slides: [
      {
        title: 'Slide 1',
        subtitle: 'Intro',
        bulletPoints: ['Point A', 'Point B'],
        notes: 'Speaker notes',
        imagePrompt: 'A crypto chart',
        order: 0,
      },
      {
        title: 'Slide 2',
        bulletPoints: ['Point C'],
        imagePrompt: 'A blockchain diagram',
        order: 1,
      },
    ],
    captions: {
      blog: {
        seoTitle: 'SEO Title',
        metaDescription: 'Meta desc',
        introText: 'Intro',
        sections: ['Section 1'],
        tags: ['crypto', 'binance'],
      },
      twitter: {
        singles: ['Tweet 1', 'Tweet 2', 'Tweet 3'],
        thread: 'Thread content',
      },
    },
    metadata: {
      totalSlides: 2,
      generatedAt: '2024-01-01T00:00:00Z',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Re-wire $transaction to call the callback with txMock
  prismaMock.$transaction.mockImplementation(
    (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)
  );
});

describe('replaceGeneratedContent', () => {
  it('rejects stale revision (generationRevision mismatch)', async () => {
    txMock.deckProject.findFirst.mockResolvedValue(
      fakeDeck({ generationRevision: 3 })
    );

    const result = await replaceGeneratedContent(
      'deck-1',
      'ws-1',
      'deck-1:rev:1', // stale revision — deck is now at 3
      fakeGenerated()
    );

    expect(result).toEqual({
      applied: false,
      currentRevision: 3,
    });

    // Should NOT delete slides or create new ones
    expect(txMock.slide.deleteMany).not.toHaveBeenCalled();
    expect(txMock.slide.create).not.toHaveBeenCalled();
    expect(txMock.captionPackage.upsert).not.toHaveBeenCalled();
  });

  it('atomically replaces slides when revision matches', async () => {
    txMock.deckProject.findFirst.mockResolvedValue(
      fakeDeck({ generationRevision: 2 })
    );
    txMock.slide.deleteMany.mockResolvedValue({ count: 1 });
    txMock.slide.create.mockResolvedValue({});
    txMock.captionPackage.upsert.mockResolvedValue({});
    txMock.deckProject.update.mockResolvedValue({});

    const generated = fakeGenerated();
    const result = await replaceGeneratedContent(
      'deck-1',
      'ws-1',
      'deck-1:rev:2',
      generated
    );

    expect(result).toEqual({
      applied: true,
      currentRevision: 2,
    });

    // Old slides deleted
    expect(txMock.slide.deleteMany).toHaveBeenCalledWith({
      where: { deckId: 'deck-1' },
    });

    // New slides created (one per generated slide)
    expect(txMock.slide.create).toHaveBeenCalledTimes(2);
    expect(txMock.slide.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deckId: 'deck-1',
        title: 'Slide 1',
        order: 0,
      }),
    });
    expect(txMock.slide.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deckId: 'deck-1',
        title: 'Slide 2',
        order: 1,
      }),
    });

    // Captions upserted
    expect(txMock.captionPackage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deckId: 'deck-1' },
      })
    );

    // Deck status updated to ready
    expect(txMock.deckProject.update).toHaveBeenCalledWith({
      where: { id: 'deck-1' },
      data: {
        status: 'ready',
        lastCompletedRevision: 2,
      },
    });
  });

  it('runs all operations inside a single $transaction call', async () => {
    txMock.deckProject.findFirst.mockResolvedValue(
      fakeDeck({ generationRevision: 1 })
    );
    txMock.slide.deleteMany.mockResolvedValue({ count: 0 });
    txMock.slide.create.mockResolvedValue({});
    txMock.captionPackage.upsert.mockResolvedValue({});
    txMock.deckProject.update.mockResolvedValue({});

    await replaceGeneratedContent('deck-1', 'ws-1', 'deck-1:rev:1', fakeGenerated());

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('throws when deck not found', async () => {
    txMock.deckProject.findFirst.mockResolvedValue(null);

    await expect(
      replaceGeneratedContent('deck-1', 'ws-1', 'deck-1:rev:1', fakeGenerated())
    ).rejects.toThrow('Article not found.');
  });
});

describe('beginGenerationRevision', () => {
  it('increments revision counter and sets status to queued', async () => {
    txMock.deckProject.findFirst.mockResolvedValue(
      fakeDeck({ generationRevision: 2 })
    );
    txMock.deckProject.update.mockResolvedValue({});

    const result = await beginGenerationRevision('deck-1', 'ws-1');

    expect(result.revision).toBe(3);
    expect(result.articleRevisionId).toBe('deck-1:rev:3');

    expect(txMock.deckProject.update).toHaveBeenCalledWith({
      where: { id: 'deck-1' },
      data: {
        generationRevision: 3,
        status: 'queued',
      },
    });
  });

  it('starts from revision 1 when deck is at 0', async () => {
    txMock.deckProject.findFirst.mockResolvedValue(
      fakeDeck({ generationRevision: 0 })
    );
    txMock.deckProject.update.mockResolvedValue({});

    const result = await beginGenerationRevision('deck-1', 'ws-1');

    expect(result.revision).toBe(1);
    expect(result.articleRevisionId).toBe('deck-1:rev:1');
  });

  it('throws when deck not found', async () => {
    txMock.deckProject.findFirst.mockResolvedValue(null);

    await expect(
      beginGenerationRevision('deck-1', 'ws-1')
    ).rejects.toThrow('Article not found.');
  });

  it('runs inside a $transaction', async () => {
    txMock.deckProject.findFirst.mockResolvedValue(fakeDeck());
    txMock.deckProject.update.mockResolvedValue({});

    await beginGenerationRevision('deck-1', 'ws-1');

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('parseRevisionNumber', () => {
  it('parses valid revision ids', () => {
    expect(parseRevisionNumber('deck-1:rev:3')).toBe(3);
    expect(parseRevisionNumber('abc:rev:0')).toBe(0);
  });

  it('returns 0 for malformed revision ids', () => {
    expect(parseRevisionNumber('invalid')).toBe(0);
    expect(parseRevisionNumber('')).toBe(0);
    expect(parseRevisionNumber('deck:rev:notanumber')).toBe(0);
  });
});
