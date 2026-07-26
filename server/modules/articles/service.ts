import type { GeneratedDeckResponse } from '@/lib/gemini';
import { DEFAULT_ILLUSTRATION_STYLE } from '@/lib/config';
import type { DeckStatus } from '@/lib/schemas';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { AppError } from '@/server/http/app-error';
import { getLatestDeckJob, serializeJobRun } from '@/server/modules/jobs/service';
import { createArticleCoverRepository } from '@/server/modules/covers/repository';
import { getArticleCover } from '@/server/modules/covers/service';

import {
  createArticleRepository,
  type CaptionRecord,
  type DeckProjectRecord,
  type SlideRecord,
} from './repository';

type SlideWithBulletPoints = Omit<SlideRecord, 'bullets'> & {
  bullets: string[];
  bulletPoints: string[];
};

type CaptionWithArrays = Omit<CaptionRecord, 'blogSections' | 'blogTags'> & {
  blogSections: string[];
  blogTags: string[];
};

function repository() {
  return createArticleRepository(getRuntimeDatabase());
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function serializeSlide(slide: SlideRecord): SlideWithBulletPoints {
  const bullets = readStringArray(slide.bullets);
  return { ...slide, bullets, bulletPoints: bullets };
}

function serializeCaptions(captions: CaptionRecord | null): CaptionWithArrays | null {
  if (!captions) return null;
  return {
    ...captions,
    blogSections: readStringArray(captions.blogSections),
    blogTags: readStringArray(captions.blogTags),
  };
}

function articleNotFound(): AppError {
  return new AppError({
    code: 'ARTICLE_NOT_FOUND',
    message: 'Article not found.',
    status: 404,
  });
}

function slideNotFound(): AppError {
  return new AppError({
    code: 'SLIDE_NOT_FOUND',
    message: 'Slide not found.',
    status: 404,
  });
}

function invalidSlideOrder(message: string): AppError {
  return new AppError({ code: 'INVALID_SLIDE_ORDER', message, status: 400 });
}

function articleRevisionId(deckId: string, revision: number): string {
  return `${deckId}:rev:${revision}`;
}

function parseArticleRevision(revisionId: string): { deckId: string; revision: number } | null {
  const match = /^(.+):rev:(0|[1-9][0-9]*)$/.exec(revisionId);
  if (!match) return null;
  const revision = Number(match[2]);
  return Number.isSafeInteger(revision) ? { deckId: match[1], revision } : null;
}

export function parseRevisionNumber(revisionId: string): number {
  return parseArticleRevision(revisionId)?.revision ?? 0;
}

export function createDeckProject(
  title: string,
  content: string,
  description: string | undefined,
  illustrationStyle: string | undefined,
  workspaceId: string,
  idempotencyKey?: string,
): Promise<DeckProjectRecord> {
  const now = new Date();
  const input = {
    id: idempotencyKey ?? crypto.randomUUID(),
    workspaceId,
    title,
    content,
    description: description ?? null,
    illustrationStyle: illustrationStyle || DEFAULT_ILLUSTRATION_STYLE,
    status: 'draft',
    now,
  } as const;
  if (!idempotencyKey) return repository().createDeck(input);
  return repository().createDeckIdempotently(input).then((deck) => {
    if (deck) return deck;
    throw new AppError({
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'This article request conflicts with an earlier request.',
      status: 409,
    });
  });
}

export function listDeckProjects(workspaceId: string, limit = 10) {
  return repository().listDecks(workspaceId, limit);
}

export async function getDeckProject(id: string, workspaceId: string) {
  const bundle = await repository().getDeckBundle(workspaceId, id);
  if (!bundle) return null;
  const cover = await getArticleCover({
    repository: createArticleCoverRepository(getRuntimeDatabase()),
    workspaceId,
    articleId: id,
  });
  return {
    ...bundle.deck,
    slides: bundle.slides.map(serializeSlide),
    captions: serializeCaptions(bundle.captions),
    cover,
    renderAssets: bundle.renderAssets,
  };
}

export async function getDeckWithAssets(deckId: string, workspaceId: string) {
  const deck = await getDeckProject(deckId, workspaceId);
  if (!deck) return null;
  const lastJob = await getLatestDeckJob(deckId, workspaceId);
  return {
    ...deck,
    lastJob: lastJob ? serializeJobRun(lastJob) : null,
  };
}

export async function updateDeckProject(
  id: string,
  workspaceId: string,
  data: Partial<{
    title: string;
    description: string;
    theme: string;
    status: DeckStatus;
    content: string;
  }>,
) {
  const updated = await repository().updateDeck({
    deckId: id,
    workspaceId,
    data,
    now: new Date(),
  });
  if (!updated) throw articleNotFound();
  const deck = await getDeckProject(id, workspaceId);
  if (!deck) throw articleNotFound();
  return deck;
}

export async function deleteDeckProject(id: string, workspaceId: string) {
  const deleted = await repository().deleteDeck(workspaceId, id);
  if (!deleted) throw articleNotFound();
  return deleted;
}

export async function replaceGeneratedContent(
  deckId: string,
  workspaceId: string,
  revisionId: string,
  generated: GeneratedDeckResponse,
) {
  const parsed = parseArticleRevision(revisionId);
  if (!parsed || parsed.deckId !== deckId) {
    throw new AppError({
      code: 'INVALID_ARTICLE_REVISION',
      message: 'Article revision is invalid.',
      status: 400,
    });
  }
  const now = new Date();
  const result = await repository().replaceGeneratedContent({
    deckId,
    workspaceId,
    revision: parsed.revision,
    slides: generated.slides.map((slide) => ({
      id: crypto.randomUUID(),
      title: slide.title,
      subtitle: slide.subtitle ?? null,
      bullets: slide.bulletPoints,
      notes: slide.notes ?? null,
      imagePrompt: slide.imagePrompt || null,
      order: slide.order,
    })),
    captionId: crypto.randomUUID(),
    captions: {
      blogTitle: generated.captions.blog?.seoTitle ?? null,
      blogMeta: generated.captions.blog?.metaDescription ?? null,
      blogIntro: generated.captions.blog?.introText ?? null,
      blogSections: generated.captions.blog?.sections ?? [],
      blogTags: generated.captions.blog?.tags ?? [],
      xSingle1: generated.captions.twitter?.singles?.[0] ?? null,
      xSingle2: generated.captions.twitter?.singles?.[1] ?? null,
      xSingle3: generated.captions.twitter?.singles?.[2] ?? null,
      xThread: generated.captions.twitter?.thread ?? null,
    },
    now,
  });
  if (!result) throw articleNotFound();
  return result.applied
    ? { applied: true as const, currentRevision: result.currentRevision }
    : { applied: false as const, currentRevision: result.currentRevision };
}

export async function beginGenerationRevision(deckId: string, workspaceId: string) {
  const deck = await repository().beginGenerationRevision({
    deckId,
    workspaceId,
    now: new Date(),
  });
  if (!deck) throw articleNotFound();
  return {
    deck,
    revision: deck.generationRevision,
    articleRevisionId: articleRevisionId(deckId, deck.generationRevision),
  };
}

export async function getCurrentRevisionContext(deckId: string, workspaceId: string) {
  const deck = await repository().findDeck(workspaceId, deckId);
  if (!deck) throw articleNotFound();
  return {
    deck,
    revision: deck.generationRevision,
    articleRevisionId: articleRevisionId(deckId, deck.generationRevision),
  };
}

export async function markDeckStatus(
  deckId: string,
  workspaceId: string,
  status: DeckStatus,
  options?: { expectedGenerationRevision?: number },
) {
  const deck = await repository().markDeckStatus({
    deckId,
    workspaceId,
    status,
    expectedGenerationRevision: options?.expectedGenerationRevision,
    now: new Date(),
  });
  // A guarded miss means another generation revision owns the deck now; the
  // stale caller must not clobber it, so report null instead of not-found.
  if (!deck) {
    if (options?.expectedGenerationRevision !== undefined) return null;
    throw articleNotFound();
  }
  return deck;
}

export async function markSlidesImagePending(
  workspaceId: string,
  deckId: string,
  slideIds: string[],
) {
  if (slideIds.length === 0) return;
  return repository().markSlidesImagePending({
    workspaceId,
    deckId,
    slideIds,
    now: new Date(),
  });
}

export async function markSlideImageFailed(
  workspaceId: string,
  deckId: string,
  slideId: string,
  message: string,
) {
  const slide = await repository().markSlideImageFailed({
    workspaceId,
    deckId,
    slideId,
    message,
    now: new Date(),
  });
  if (!slide) throw slideNotFound();
  return slide;
}

export async function markSlideImageGenerated(
  workspaceId: string,
  deckId: string,
  slideId: string,
  imageUrl: string,
) {
  const slide = await repository().markSlideImageGenerated({
    workspaceId,
    deckId,
    slideId,
    imageUrl,
    now: new Date(),
  });
  if (!slide) throw slideNotFound();
  return slide;
}

export async function listSlidesForImageGeneration(deckId: string, workspaceId: string) {
  const result = await repository().getDeckWithSlides(workspaceId, deckId);
  if (!result) return null;
  return {
    ...result.deck,
    slides: result.slides.map(serializeSlide),
  };
}

export async function createSlide(
  workspaceId: string,
  deckId: string,
  input: {
    title: string;
    subtitle?: string;
    bullets?: string[];
    notes?: string;
    order?: number;
  },
) {
  const slide = await repository().createSlide({
    id: crypto.randomUUID(),
    workspaceId,
    deckId,
    title: input.title,
    subtitle: input.subtitle ?? null,
    bullets: input.bullets ?? [],
    notes: input.notes ?? null,
    order: input.order,
    now: new Date(),
  });
  if (!slide) throw articleNotFound();
  return serializeSlide(slide);
}

export async function updateSlide(
  workspaceId: string,
  deckId: string,
  slideId: string,
  update: { title?: string; subtitle?: string; bullets?: string[]; notes?: string },
) {
  const slide = await repository().updateSlide({
    workspaceId,
    deckId,
    slideId,
    update,
    now: new Date(),
  });
  if (!slide) throw slideNotFound();
  return serializeSlide(slide);
}

export async function reorderSlides(
  workspaceId: string,
  deckId: string,
  slideOrder: Array<{ id: string; order: number }>,
) {
  const ids = new Set(slideOrder.map((slide) => slide.id));
  if (ids.size !== slideOrder.length) {
    throw invalidSlideOrder('Slide reorder payload is invalid.');
  }
  const orders = slideOrder.map((slide) => slide.order).sort((left, right) => left - right);
  if (orders.some((order, index) => order !== index)) {
    throw invalidSlideOrder('Slide reorder payload must be normalized.');
  }
  const result = await repository().reorderSlides({
    workspaceId,
    deckId,
    slideOrder,
    now: new Date(),
  });
  if (result === 'not_found') throw articleNotFound();
  if (result === 'invalid') {
    throw invalidSlideOrder('Slide reorder payload references another article.');
  }
}

export async function deleteSlide(workspaceId: string, deckId: string, slideId: string) {
  const deleted = await repository().deleteSlide({
    workspaceId,
    deckId,
    slideId,
    now: new Date(),
  });
  if (!deleted) throw slideNotFound();
}

export function createRenderAsset(
  deckId: string,
  filename: string,
  filePath: string,
  assetType: 'png' | 'pptx' | 'pdf',
  jobId?: string,
) {
  const mimeType = assetType === 'pdf'
    ? 'application/pdf'
    : assetType === 'png'
      ? 'image/png'
      : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  return repository().createRenderAsset({
    id: crypto.randomUUID(),
    deckId,
    filename,
    filePath,
    format: assetType,
    mimeType,
    jobId: jobId ?? null,
    now: new Date(),
  });
}

export function getRenderAssets(deckId: string) {
  return repository().getRenderAssets(deckId);
}

export async function getCaptions(deckId: string) {
  return serializeCaptions(await repository().getCaptions(deckId));
}
