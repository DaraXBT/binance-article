import { describe, expect, it, vi } from 'vitest';

import {
  getPublicationDraft,
  savePublicationDraft,
  serializePublicationDraft,
} from './draft-service';

type PublicationTarget = 'binance-square' | 'x';
type PublicationKind = 'post' | 'article';

interface KindAwareServiceInput {
  repository: KindAwareRepository;
  actorUserId: string;
  workspaceId: string;
  articleId: string;
  target: PublicationTarget;
  kind: PublicationKind;
  draftId?: string;
  input: unknown;
  now?: Date;
}

interface KindAwareRepository {
  getDraft(input: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  saveDraft(input: Record<string, unknown>): Promise<Record<string, unknown> | null>;
}

const saveKindAwareDraft = savePublicationDraft as unknown as (
  input: KindAwareServiceInput,
) => Promise<Record<string, unknown>>;

const getKindAwareDraft = getPublicationDraft as unknown as (
  input: Omit<KindAwareServiceInput, 'draftId' | 'input' | 'now'>,
) => Promise<Record<string, unknown> | null>;

const serializeKindAwareDraft = serializePublicationDraft as unknown as (
  input: Record<string, unknown>,
) => Record<string, unknown>;

const now = new Date('2026-08-16T00:00:00.000Z');

function repository() {
  return {
    getDraft: vi.fn(async (_input: Record<string, unknown>) => null),
    saveDraft: vi.fn(async (input: Record<string, unknown>) => ({
      id: input.draftId,
      workspaceId: input.workspaceId,
      articleId: input.articleId,
      target: input.target,
      kind: input.kind,
      revision: 1,
      status: 'draft',
      payload: input.payload,
      expiresAt: input.expiresAt,
      publishedUrl: null,
      updatedAt: input.now,
    })),
  };
}

function serviceInput(
  target: PublicationTarget,
  kind: PublicationKind,
  payload: Record<string, unknown>,
) {
  return {
    repository: repository(),
    actorUserId: 'user_1',
    workspaceId: 'workspace_1',
    articleId: 'article_1',
    target,
    kind,
    draftId: `draft_${target}_${kind}`,
    input: { expectedRevision: 0, ...payload },
    now,
  } satisfies KindAwareServiceInput;
}

describe('kind-aware publication drafts', () => {
  it.each(['binance-square', 'x'] as const)('saves a text-only %s post', async (target) => {
    const input = serviceInput(target, 'post', { text: 'Post without media', orderedAssetIds: [] });

    await expect(saveKindAwareDraft(input)).resolves.toMatchObject({
      target,
      kind: 'post',
      text: 'Post without media',
      orderedAssetIds: [],
    });
    expect(input.repository.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      target,
      kind: 'post',
      payload: { text: 'Post without media', orderedAssetIds: [] },
    }));
  });

  it.each(['binance-square', 'x'] as const)(
    'saves a media-free %s article without synthesizing a cover',
    async (target) => {
      const input = serviceInput(target, 'article', {
        title: 'Article title',
        markdown: 'Article body',
        orderedAssetIds: [],
      });

      const saved = await saveKindAwareDraft(input);
      expect(saved).toMatchObject({
        target,
        kind: 'article',
        title: 'Article title',
        markdown: 'Article body',
        orderedAssetIds: [],
      });
      expect(saved).not.toHaveProperty('cover');
      expect(input.repository.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'article',
        payload: {
          title: 'Article title', markdown: 'Article body', orderedAssetIds: [],
        },
      }));
    },
  );

  it.each(['binance-square', 'x'] as const)('saves an image-only %s post', async (target) => {
    const input = serviceInput(target, 'post', { text: '', orderedAssetIds: ['asset_1'] });

    await expect(saveKindAwareDraft(input)).resolves.toMatchObject({
      target, kind: 'post', text: '', orderedAssetIds: ['asset_1'],
    });
  });

  it('uses platform-specific post limits', async () => {
    await expect(saveKindAwareDraft(serviceInput('binance-square', 'post', {
      text: 'b'.repeat(2_100), orderedAssetIds: [],
    }))).resolves.toMatchObject({ kind: 'post' });
    await expect(saveKindAwareDraft(serviceInput('binance-square', 'post', {
      text: 'b'.repeat(2_101), orderedAssetIds: [],
    }))).rejects.toMatchObject({ code: 'INVALID_PUBLICATION_DRAFT', status: 400 });
    await expect(saveKindAwareDraft(serviceInput('x', 'post', {
      text: 'x'.repeat(281), orderedAssetIds: [],
    }))).rejects.toMatchObject({ code: 'INVALID_PUBLICATION_DRAFT', status: 400 });
  });

  it.each([
    ['post', { text: '', orderedAssetIds: [] }],
    ['article', { title: '', markdown: 'Body', orderedAssetIds: [] }],
    ['article', { title: 'Title', markdown: '', orderedAssetIds: [] }],
  ] as const)('rejects an invalid %s draft before persistence', async (kind, payload) => {
    const input = serviceInput('x', kind, payload);

    await expect(saveKindAwareDraft(input)).rejects.toMatchObject({
      code: 'INVALID_PUBLICATION_DRAFT', status: 400,
    });
    expect(input.repository.saveDraft).not.toHaveBeenCalled();
  });

  it.each([
    ['missing selected image', 'Body without the selected image.'],
    ['duplicate selected image', '![One](asset:asset_1)\n\n![Two](asset:asset_1)'],
    ['external image', '![One](asset:asset_1)\n\n![External](https://example.invalid/x.png)'],
    ['reference-style image', '![One](asset:asset_1)\n\n![External][ref]\n[ref]: /etc/x.png'],
    ['raw HTML image', '![One](asset:asset_1)\n\n<img src="/etc/x.png">'],
    ['code-hidden image', '![One](asset:asset_1)\n\n`![Hidden](/etc/x.png)`'],
  ])('rejects an Article draft with a %s before persistence', async (_name, markdown) => {
    const input = serviceInput('x', 'article', {
      title: 'Strict reviewed media', markdown, orderedAssetIds: ['asset_1'],
    });

    await expect(saveKindAwareDraft(input)).rejects.toMatchObject({
      code: 'INVALID_PUBLICATION_DRAFT', status: 400,
    });
    expect(input.repository.saveDraft).not.toHaveBeenCalled();
  });

  it('queries drafts by target and kind so four drafts can coexist', async () => {
    const repo = repository();

    for (const target of ['binance-square', 'x'] as const) {
      for (const kind of ['post', 'article'] as const) {
        await getKindAwareDraft({
          repository: repo,
          actorUserId: 'user_1',
          workspaceId: 'workspace_1',
          articleId: 'article_1',
          target,
          kind,
        });
      }
    }

    expect(repo.getDraft.mock.calls.map(([input]) => [input.target, input.kind])).toEqual([
      ['binance-square', 'post'],
      ['binance-square', 'article'],
      ['x', 'post'],
      ['x', 'article'],
    ]);
  });

  it('serializes payload shape from kind rather than platform', () => {
    const record = {
      id: 'draft_x_article',
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      target: 'x',
      kind: 'article',
      revision: 1,
      status: 'draft',
      payload: { title: 'Title', markdown: 'Body', orderedAssetIds: [] },
      expiresAt: new Date('2026-08-16T00:15:00.000Z'),
      publishedUrl: null,
      updatedAt: now,
    };

    expect(serializeKindAwareDraft(record)).toMatchObject({
      target: 'x', kind: 'article', title: 'Title', markdown: 'Body',
    });
  });

  it('loads a migrated legacy Binance article whose focal cover has no asset ID', () => {
    const record = {
      id: 'draft_binance_legacy',
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      target: 'binance-square',
      kind: 'article',
      revision: 4,
      status: 'draft',
      payload: {
        title: 'Legacy article',
        markdown: 'Legacy body',
        cover: { focalX: 0.25, focalY: 0.75, targetWidth: 1000, targetHeight: 400 },
        orderedAssetIds: [],
      },
      expiresAt: new Date('2026-08-16T00:15:00.000Z'),
      publishedUrl: null,
      updatedAt: now,
    };

    expect(serializeKindAwareDraft(record)).toMatchObject({
      target: 'binance-square',
      kind: 'article',
      cover: { focalX: 0.25, focalY: 0.75, targetWidth: 1000, targetHeight: 400 },
    });
  });

  it('accepts the legacy omitted-kind Binance payload shape after migration', async () => {
    const repo = repository();

    await expect(savePublicationDraft({
      repository: repo as never,
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      target: 'binance-square',
      draftId: 'draft_binance_legacy',
      input: {
        expectedRevision: 4,
        title: 'Legacy article',
        markdown: 'Legacy body',
        cover: { focalX: 0.25, focalY: 0.75 },
        orderedAssetIds: [],
      },
      now,
    })).resolves.toMatchObject({
      target: 'binance-square',
      kind: 'article',
      cover: { focalX: 0.25, focalY: 0.75, targetWidth: 1000, targetHeight: 400 },
    });
  });
});
