import { describe, expect, it, vi } from 'vitest';

import { createArticleRepository } from './repository';

function deckRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deck_1', workspaceId: 'workspace_1', title: 'Article', description: null,
    content: 'Content', theme: 'default', customTheme: null, illustrationStyle: 'pixel-art',
    status: 'draft', generationRevision: 1, lastCompletedRevision: 0,
    createdAt: new Date('2026-07-19T00:00:00.000Z'),
    updatedAt: new Date('2026-07-19T00:00:00.000Z'),
    ...overrides,
  };
}

function capturingClient(defaultRows: unknown[] = [deckRow()]) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const query = (rows = defaultRows) => vi.fn(async (
    strings: TemplateStringsArray, ...values: unknown[]
  ) => {
    queries.push({ text: strings.join('?'), values });
    return rows;
  });
  return { queries, query };
}

describe('Neon article repository', () => {
  it('creates explicit records and lists only one workspace deterministically', async () => {
    const { queries, query } = capturingClient();
    const client = query();
    const repository = createArticleRepository({ $client: client } as never);
    const now = new Date('2026-07-19T12:00:00.000Z');

    await repository.createDeck({
      id: 'deck_1', workspaceId: 'workspace_1', title: 'Title', content: 'Body',
      description: null, illustrationStyle: 'pixel-art', status: 'draft', now,
    });
    await repository.listDecks('workspace_1', 10);

    expect(queries[0]?.text).toMatch(/INSERT INTO "DeckProject"/);
    expect(queries[0]?.text).toMatch(/"createdAt", "updatedAt"/);
    expect(queries[0]?.values).toEqual(expect.arrayContaining(['deck_1', 'workspace_1', now]));
    expect(queries[1]?.text).toMatch(/WHERE deck\."workspaceId" =/);
    expect(queries[1]?.text).toMatch(/ORDER BY deck\."updatedAt" DESC, deck\."id" DESC/);
    expect(queries[1]?.text).toMatch(/COUNT\(slide\."id"\)/);
  });

  it('loads a tenant-scoped bundle through a fixed Neon transaction', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const transaction = vi.fn(async (
      build: (query: (strings: TemplateStringsArray, ...values: unknown[]) => unknown) => unknown[],
      options: unknown,
    ) => {
      const built = build((strings, ...values) => {
        captured.push({ text: strings.join('?'), values });
        return { text: strings.join('?'), values };
      });
      expect(built).toHaveLength(4);
      expect(options).toEqual({ isolationLevel: 'ReadCommitted' });
      return [[deckRow()], [], [], []];
    });
    const repository = createArticleRepository({ $client: { transaction } } as never);

    await expect(repository.getDeckBundle('workspace_1', 'deck_1')).resolves.toMatchObject({
      deck: { id: 'deck_1' }, slides: [], captions: null, renderAssets: [],
    });
    expect(captured.every((item) => item.values.includes('workspace_1'))).toBe(true);
    expect(captured[1]?.text).toMatch(/INNER JOIN "DeckProject"/);
    expect(captured[2]?.text).toMatch(/INNER JOIN "DeckProject"/);
    expect(captured[3]?.text).toMatch(/INNER JOIN "DeckProject"/);
  });

  it('keeps updates and deletes workspace-scoped in the mutation statement', async () => {
    const { queries, query } = capturingClient();
    const repository = createArticleRepository({ $client: query() } as never);
    const now = new Date('2026-07-19T12:00:00.000Z');

    await repository.updateDeck({
      deckId: 'deck_1', workspaceId: 'workspace_1', data: { title: 'Changed' }, now,
    });
    await repository.deleteDeck('workspace_1', 'deck_1');

    expect(queries[0]?.text).toMatch(/UPDATE "DeckProject"[\s\S]*WHERE "id" = [\s\S]*"workspaceId" =/);
    expect(queries[1]?.text).toMatch(/DELETE FROM "DeckProject"[\s\S]*"workspaceId" =/);
  });

  it('increments generation revisions atomically and returns the winning value', async () => {
    const { queries, query } = capturingClient([deckRow({ generationRevision: 2 })]);
    const repository = createArticleRepository({ $client: query() } as never);

    await repository.beginGenerationRevision({
      deckId: 'deck_1', workspaceId: 'workspace_1',
      now: new Date('2026-07-19T12:00:00.000Z'),
    });

    expect(queries[0]?.text).toMatch(/"generationRevision" = "generationRevision" \+ 1/);
    expect(queries[0]?.text).toMatch(/"status" = 'queued'/);
    expect(queries[0]?.text).toMatch(/"workspaceId" =/);
    expect(queries[0]?.text).not.toMatch(/SELECT[\s\S]*UPDATE/);
  });

  it('locks the revision and atomically replaces slides, captions, and deck status', async () => {
    const { queries, query } = capturingClient([{ applied: true, currentRevision: 1 }]);
    const repository = createArticleRepository({ $client: query() } as never);
    const now = new Date('2026-07-19T12:00:00.000Z');

    await repository.replaceGeneratedContent({
      deckId: 'deck_1', workspaceId: 'workspace_1', revision: 1,
      captionId: 'caption_1', now,
      slides: [{
        id: 'slide_1', title: 'Slide', subtitle: null, bullets: ['A'], notes: null,
        imagePrompt: 'Chart', order: 0,
      }],
      captions: {
        blogTitle: 'SEO', blogMeta: null, blogIntro: null,
        blogSections: ['Section'], blogTags: ['tag'], xSingle1: null,
        xSingle2: null, xSingle3: null, xThread: null,
      },
    });

    expect(queries[0]?.text).toMatch(/FOR UPDATE/);
    expect(queries[0]?.text).toMatch(/"generationRevision" =/);
    expect(queries[0]?.text).toMatch(/DELETE FROM "Slide"/);
    expect(queries[0]?.text).toMatch(/jsonb_to_recordset/);
    expect(queries[0]?.text).toMatch(/INSERT INTO "CaptionPackage"/);
    expect(queries[0]?.text).toMatch(/ON CONFLICT \("deckId"\) DO UPDATE/);
    expect(queries[0]?.text).toMatch(/UPDATE "DeckProject"/);
    expect(queries[0]?.text).toMatch(/lastCompletedRevision/);
    expect(queries[0]?.values).toEqual(expect.arrayContaining(['deck_1', 'workspace_1', now]));
  });

  it('scopes image mutations through both article and workspace', async () => {
    const { queries, query } = capturingClient([{ id: 'slide_1' }]);
    const repository = createArticleRepository({ $client: query() } as never);
    const now = new Date('2026-07-19T12:00:00.000Z');

    await repository.markSlideImageGenerated({
      workspaceId: 'workspace_1', deckId: 'deck_1', slideId: 'slide_1',
      imageUrl: 'object-key', now,
    });

    expect(queries[0]?.text).toMatch(/UPDATE "Slide" AS slide/);
    expect(queries[0]?.text).toMatch(/FROM "DeckProject" AS deck/);
    expect(queries[0]?.text).toMatch(/deck\."workspaceId" =/);
    expect(queries[0]?.text).toMatch(/slide\."deckId" =/);
  });

  it('serializes reordering behind a deck lock and uses collision-free temporary orders', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const transaction = vi.fn(async (
      build: (query: (strings: TemplateStringsArray, ...values: unknown[]) => unknown) => unknown[],
    ) => {
      const built = build((strings, ...values) => {
        captured.push({ text: strings.join('?'), values });
        return { text: strings.join('?'), values };
      });
      expect(built.length).toBeGreaterThanOrEqual(4);
      return [[{ id: 'deck_1' }], [{ id: 'slide_1' }], [{ id: 'slide_1' }], [{ valid: true }], []];
    });
    const repository = createArticleRepository({ $client: { transaction } } as never);

    await expect(repository.reorderSlides({
      workspaceId: 'workspace_1', deckId: 'deck_1',
      slideOrder: [{ id: 'slide_1', order: 0 }],
      now: new Date('2026-07-19T12:00:00.000Z'),
    })).resolves.toBe('updated');

    expect(captured[0]?.text).toMatch(/FOR UPDATE/);
    expect(captured[1]?.text).toMatch(/jsonb_to_recordset/);
    expect(captured[1]?.text).toMatch(/\+ 1000/);
    expect(captured[2]?.text).toMatch(/SET "order" = requested\."order"/);
  });
});
