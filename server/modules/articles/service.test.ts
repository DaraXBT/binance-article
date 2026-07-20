import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { repositoryMock, latestJobMock, serializeJobMock } = vi.hoisted(() => ({
  repositoryMock: {
    createDeck: vi.fn(),
    createDeckIdempotently: vi.fn(),
    listDecks: vi.fn(),
    findDeck: vi.fn(),
    getDeckBundle: vi.fn(),
    updateDeck: vi.fn(),
    deleteDeck: vi.fn(),
    replaceGeneratedContent: vi.fn(),
    beginGenerationRevision: vi.fn(),
    markDeckStatus: vi.fn(),
    getDeckWithSlides: vi.fn(),
    markSlidesImagePending: vi.fn(),
    markSlideImageFailed: vi.fn(),
    markSlideImageGenerated: vi.fn(),
    createSlide: vi.fn(),
    updateSlide: vi.fn(),
    reorderSlides: vi.fn(),
    deleteSlide: vi.fn(),
    createRenderAsset: vi.fn(),
    getRenderAssets: vi.fn(),
    getCaptions: vi.fn(),
  },
  latestJobMock: vi.fn(),
  serializeJobMock: vi.fn((job: unknown) => job),
}));

vi.mock('./repository', () => ({
  createArticleRepository: vi.fn(() => repositoryMock),
}));
vi.mock('@/server/db/runtime', () => ({
  getRuntimeDatabase: vi.fn(() => ({ database: true })),
}));
vi.mock('@/server/modules/jobs/service', () => ({
  getLatestDeckJob: latestJobMock,
  serializeJobRun: serializeJobMock,
}));

import type { GeneratedDeckResponse } from '@/lib/gemini';
import {
  beginGenerationRevision,
  createDeckProject,
  createSlide,
  getDeckProject,
  getDeckWithAssets,
  markSlideImageFailed,
  markSlideImageGenerated,
  markSlidesImagePending,
  parseRevisionNumber,
  reorderSlides,
  replaceGeneratedContent,
  updateDeckProject,
} from './service';

function fakeDeck(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deck_1', workspaceId: 'workspace_1', title: 'Article', description: null,
    content: 'Content', theme: 'default', customTheme: null,
    illustrationStyle: 'pixel-art', status: 'draft' as const,
    generationRevision: 1, lastCompletedRevision: 0,
    createdAt: new Date('2026-07-19T00:00:00.000Z'),
    updatedAt: new Date('2026-07-19T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeSlide(overrides: Record<string, unknown> = {}) {
  return {
    id: 'slide_1', deckId: 'deck_1', title: 'Slide', subtitle: null,
    bullets: ['One', 2, 'Two'], notes: null, imageUrl: null,
    imageStatus: 'pending' as const, imageError: null, imagePrompt: null, order: 0,
    createdAt: new Date('2026-07-19T00:00:00.000Z'),
    updatedAt: new Date('2026-07-19T00:00:00.000Z'),
    ...overrides,
  };
}

function generatedDeck(): GeneratedDeckResponse {
  return {
    slides: [{
      title: 'Generated', subtitle: 'Intro', bulletPoints: ['A'], notes: 'Notes',
      imagePrompt: 'Chart', order: 0,
    }],
    captions: {
      blog: { seoTitle: 'SEO', sections: ['Section'], tags: ['crypto'] },
      twitter: { singles: ['Post'], thread: 'Thread' },
    },
    metadata: { totalSlides: 1, generatedAt: '2026-07-19T00:00:00.000Z' },
  };
}

describe('Worker-safe article service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T12:00:00.000Z'));
    repositoryMock.createDeck.mockResolvedValue(fakeDeck());
    repositoryMock.createDeckIdempotently.mockResolvedValue(fakeDeck());
    repositoryMock.findDeck.mockResolvedValue(fakeDeck());
    repositoryMock.getDeckBundle.mockResolvedValue({
      deck: fakeDeck(), slides: [fakeSlide()],
      captions: { id: 'caption_1', deckId: 'deck_1', blogSections: ['A', 1], blogTags: ['tag'],
        blogTitle: null, blogMeta: null, blogIntro: null, xSingle1: null, xSingle2: null,
        xSingle3: null, xThread: null, createdAt: new Date(), updatedAt: new Date() },
      renderAssets: [],
    });
    repositoryMock.updateDeck.mockResolvedValue(fakeDeck());
    repositoryMock.beginGenerationRevision.mockResolvedValue(fakeDeck({ generationRevision: 2 }));
    repositoryMock.replaceGeneratedContent.mockResolvedValue({ applied: true, currentRevision: 1 });
    repositoryMock.reorderSlides.mockResolvedValue('updated');
    repositoryMock.createSlide.mockResolvedValue(fakeSlide());
    repositoryMock.markSlidesImagePending.mockResolvedValue(1);
    repositoryMock.markSlideImageFailed.mockResolvedValue(fakeSlide({ imageStatus: 'failed' }));
    repositoryMock.markSlideImageGenerated.mockResolvedValue(fakeSlide({ imageStatus: 'generated' }));
    latestJobMock.mockResolvedValue(null);
  });

  afterEach(() => vi.useRealTimers());

  it('creates articles with an explicit UUID and timestamps', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');

    await createDeckProject('Title', 'Body', undefined, undefined, 'workspace_1');

    expect(repositoryMock.createDeck).toHaveBeenCalledWith({
      id: '00000000-0000-4000-8000-000000000001', workspaceId: 'workspace_1',
      title: 'Title', content: 'Body', description: null,
      illustrationStyle: 'pixel-art', status: 'draft',
      now: new Date('2026-07-19T12:00:00.000Z'),
    });
  });

  it('sanitizes both stored bullets and public bulletPoints plus caption arrays', async () => {
    const deck = await getDeckProject('deck_1', 'workspace_1');

    expect(deck?.slides[0].bullets).toEqual(['One', 'Two']);
    expect(deck?.slides[0].bulletPoints).toEqual(['One', 'Two']);
    expect(deck?.captions?.blogSections).toEqual(['A']);
  });

  it('returns the latest serialized job with a tenant-scoped article bundle', async () => {
    latestJobMock.mockResolvedValue({ id: 'job_1' });
    await expect(getDeckWithAssets('deck_1', 'workspace_1')).resolves.toMatchObject({
      id: 'deck_1', lastJob: { id: 'job_1' },
    });
    expect(latestJobMock).toHaveBeenCalledWith('deck_1', 'workspace_1');
  });

  it('updates through a workspace-scoped write and rejects missing articles opaquely', async () => {
    repositoryMock.updateDeck.mockResolvedValueOnce(null);
    await expect(updateDeckProject('deck_1', 'workspace_1', { title: 'Changed' }))
      .rejects.toMatchObject({ code: 'ARTICLE_NOT_FOUND', status: 404 });
  });

  it('parses only canonical revision identifiers', () => {
    expect(parseRevisionNumber('deck_1:rev:12')).toBe(12);
    expect(parseRevisionNumber('deck_1:rev:12junk')).toBe(0);
    expect(parseRevisionNumber('deck_1:rev:-1')).toBe(0);
    expect(parseRevisionNumber('invalid')).toBe(0);
  });

  it('begins a revision with one atomic repository increment', async () => {
    await expect(beginGenerationRevision('deck_1', 'workspace_1')).resolves.toMatchObject({
      revision: 2, articleRevisionId: 'deck_1:rev:2',
    });
    expect(repositoryMock.beginGenerationRevision).toHaveBeenCalledWith({
      deckId: 'deck_1', workspaceId: 'workspace_1',
      now: new Date('2026-07-19T12:00:00.000Z'),
    });
  });

  it('rejects a revision identifier for another article before any write', async () => {
    await expect(replaceGeneratedContent(
      'deck_1', 'workspace_1', 'other:rev:1', generatedDeck(),
    )).rejects.toMatchObject({ code: 'INVALID_ARTICLE_REVISION' });
    expect(repositoryMock.replaceGeneratedContent).not.toHaveBeenCalled();
  });

  it('prepares explicit slide and caption IDs for atomic generated replacement', async () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');

    await replaceGeneratedContent('deck_1', 'workspace_1', 'deck_1:rev:1', generatedDeck());

    expect(repositoryMock.replaceGeneratedContent).toHaveBeenCalledWith(expect.objectContaining({
      deckId: 'deck_1', workspaceId: 'workspace_1', revision: 1,
      captionId: '00000000-0000-4000-8000-000000000002',
      slides: [expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000001', bullets: ['A'], order: 0,
      })],
      now: new Date('2026-07-19T12:00:00.000Z'),
    }));
  });

  it('rejects duplicate or non-normalized reorder payloads before persistence', async () => {
    await expect(reorderSlides('workspace_1', 'deck_1', [
      { id: 'slide_1', order: 0 }, { id: 'slide_1', order: 1 },
    ])).rejects.toMatchObject({ code: 'INVALID_SLIDE_ORDER' });
    await expect(reorderSlides('workspace_1', 'deck_1', [
      { id: 'slide_1', order: 1 },
    ])).rejects.toMatchObject({ code: 'INVALID_SLIDE_ORDER' });
    expect(repositoryMock.reorderSlides).not.toHaveBeenCalled();
  });

  it('creates slide IDs explicitly and keeps image writes workspace/deck scoped', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000003');
    await createSlide('workspace_1', 'deck_1', { title: 'New' });
    await markSlidesImagePending('workspace_1', 'deck_1', ['slide_1']);
    await markSlideImageFailed('workspace_1', 'deck_1', 'slide_1', 'safe reason');
    await markSlideImageGenerated('workspace_1', 'deck_1', 'slide_1', 'r2/object-key');

    expect(repositoryMock.createSlide).toHaveBeenCalledWith(expect.objectContaining({
      id: '00000000-0000-4000-8000-000000000003', workspaceId: 'workspace_1', deckId: 'deck_1',
    }));
    expect(repositoryMock.markSlidesImagePending).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace_1', deckId: 'deck_1', slideIds: ['slide_1'],
    }));
    expect(repositoryMock.markSlideImageFailed).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace_1', deckId: 'deck_1', slideId: 'slide_1',
    }));
    expect(repositoryMock.markSlideImageGenerated).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace_1', deckId: 'deck_1', slideId: 'slide_1',
    }));
  });
});
