import {
  type CaptionPackage,
  type DeckProject,
  DeckStatus,
  type Prisma,
  type Slide,
  SlideImageStatus,
} from '@prisma/client';

import { type GeneratedDeckResponse } from '@/lib/gemini';
import prisma from '@/server/integrations/prisma';
import { AppError } from '@/server/http/errors';
import { getLatestDeckJob, serializeJobRun } from '@/server/modules/jobs/service';

type SlideWithBulletPoints = Slide & {
  bulletPoints: string[];
};

type CaptionWithArrays = Omit<CaptionPackage, 'blogSections' | 'blogTags'> & {
  blogSections: string[];
  blogTags: string[];
};

function readStringArray(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function serializeSlide(slide: Slide): SlideWithBulletPoints {
  return {
    ...slide,
    bulletPoints: readStringArray(slide.bullets),
  };
}

function serializeCaptions(captions: CaptionPackage | null): CaptionWithArrays | null {
  if (!captions) {
    return null;
  }

  return {
    ...captions,
    blogSections: readStringArray(captions.blogSections),
    blogTags: readStringArray(captions.blogTags),
  };
}

async function findDeckOrNull(workspaceId: string, deckId: string) {
  return prisma.deckProject.findFirst({
    where: {
      id: deckId,
      workspaceId,
    },
  });
}

async function ensureDeck(workspaceId: string, deckId: string) {
  const deck = await findDeckOrNull(workspaceId, deckId);

  if (!deck) {
    throw new AppError({
      code: 'ARTICLE_NOT_FOUND',
      message: 'Article not found.',
      status: 404,
    });
  }

  return deck;
}

function articleRevisionId(deckId: string, revision: number) {
  return `${deckId}:rev:${revision}`;
}

export function parseRevisionNumber(revisionId: string) {
  const [, revision] = revisionId.split(':rev:');
  const parsed = Number.parseInt(revision ?? '', 10);

  return Number.isFinite(parsed) ? parsed : 0;
}

export async function createDeckProject(
  title: string,
  content: string,
  description: string | undefined,
  illustrationStyle: string | undefined,
  workspaceId: string
): Promise<DeckProject> {
  return prisma.deckProject.create({
    data: {
      workspaceId,
      title,
      content,
      description,
      illustrationStyle: illustrationStyle || 'pixel-art',
      status: DeckStatus.draft,
    },
  });
}

export async function listDeckProjects(workspaceId: string, limit = 10) {
  return prisma.deckProject.findMany({
    where: { workspaceId },
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { slides: true },
      },
    },
  });
}

export async function getDeckProject(id: string, workspaceId: string) {
  const deck = await prisma.deckProject.findFirst({
    where: {
      id,
      workspaceId,
    },
    include: {
      slides: {
        orderBy: { order: 'asc' },
      },
      captions: true,
      renderAssets: true,
    },
  });

  if (!deck) {
    return null;
  }

  return {
    ...deck,
    slides: deck.slides.map(serializeSlide),
    captions: serializeCaptions(deck.captions),
  };
}

export async function getDeckWithAssets(deckId: string, workspaceId: string) {
  const deck = await getDeckProject(deckId, workspaceId);

  if (!deck) {
    return null;
  }

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
  }>
) {
  await ensureDeck(workspaceId, id);

  const deck = await prisma.deckProject.update({
    where: { id },
    data,
    include: {
      slides: {
        orderBy: { order: 'asc' },
      },
      captions: true,
      renderAssets: true,
    },
  });

  return {
    ...deck,
    slides: deck.slides.map(serializeSlide),
    captions: serializeCaptions(deck.captions),
  };
}

export async function deleteDeckProject(id: string, workspaceId: string) {
  await ensureDeck(workspaceId, id);

  return prisma.deckProject.delete({
    where: { id },
  });
}

export async function replaceGeneratedContent(
  deckId: string,
  workspaceId: string,
  revisionId: string,
  generated: GeneratedDeckResponse
) {
  return prisma.$transaction(async (tx) => {
    const deck = await tx.deckProject.findFirst({
      where: {
        id: deckId,
        workspaceId,
      },
      include: {
        captions: true,
      },
    });

    if (!deck) {
      throw new AppError({
        code: 'ARTICLE_NOT_FOUND',
        message: 'Article not found.',
        status: 404,
      });
    }

    const revision = parseRevisionNumber(revisionId);

    if (deck.generationRevision !== revision) {
      return {
        applied: false as const,
        currentRevision: deck.generationRevision,
      };
    }

    await tx.slide.deleteMany({
      where: { deckId },
    });

    for (const slide of generated.slides) {
      await tx.slide.create({
        data: {
          deckId,
          title: slide.title,
          subtitle: slide.subtitle,
          bullets: slide.bulletPoints,
          notes: slide.notes,
          imageStatus: SlideImageStatus.pending,
          imageError: null,
          imagePrompt: slide.imagePrompt || null,
          order: slide.order,
        },
      });
    }

    await tx.captionPackage.upsert({
      where: { deckId },
      update: {
        blogTitle: generated.captions.blog?.seoTitle,
        blogMeta: generated.captions.blog?.metaDescription,
        blogIntro: generated.captions.blog?.introText,
        blogSections: generated.captions.blog?.sections ?? [],
        blogTags: generated.captions.blog?.tags ?? [],
        xSingle1: generated.captions.twitter?.singles?.[0] ?? null,
        xSingle2: generated.captions.twitter?.singles?.[1] ?? null,
        xSingle3: generated.captions.twitter?.singles?.[2] ?? null,
        xThread: generated.captions.twitter?.thread ?? null,
      },
      create: {
        deckId,
        blogTitle: generated.captions.blog?.seoTitle,
        blogMeta: generated.captions.blog?.metaDescription,
        blogIntro: generated.captions.blog?.introText,
        blogSections: generated.captions.blog?.sections ?? [],
        blogTags: generated.captions.blog?.tags ?? [],
        xSingle1: generated.captions.twitter?.singles?.[0] ?? null,
        xSingle2: generated.captions.twitter?.singles?.[1] ?? null,
        xSingle3: generated.captions.twitter?.singles?.[2] ?? null,
        xThread: generated.captions.twitter?.thread ?? null,
      },
    });

    await tx.deckProject.update({
      where: { id: deckId },
      data: {
        status: DeckStatus.ready,
        lastCompletedRevision: revision,
      },
    });

    return {
      applied: true as const,
      currentRevision: revision,
    };
  });
}

export async function beginGenerationRevision(deckId: string, workspaceId: string) {
  return prisma.$transaction(async (tx) => {
    const deck = await tx.deckProject.findFirst({
      where: {
        id: deckId,
        workspaceId,
      },
    });

    if (!deck) {
      throw new AppError({
        code: 'ARTICLE_NOT_FOUND',
        message: 'Article not found.',
        status: 404,
      });
    }

    const nextRevision = deck.generationRevision + 1;

    await tx.deckProject.update({
      where: { id: deckId },
      data: {
        generationRevision: nextRevision,
        status: DeckStatus.queued,
      },
    });

    return {
      deck,
      revision: nextRevision,
      articleRevisionId: articleRevisionId(deckId, nextRevision),
    };
  });
}

export async function getCurrentRevisionContext(deckId: string, workspaceId: string) {
  const deck = await ensureDeck(workspaceId, deckId);

  return {
    deck,
    revision: deck.generationRevision,
    articleRevisionId: articleRevisionId(deckId, deck.generationRevision),
  };
}

export async function markDeckStatus(
  deckId: string,
  workspaceId: string,
  status: DeckStatus
) {
  await ensureDeck(workspaceId, deckId);

  return prisma.deckProject.update({
    where: { id: deckId },
    data: { status },
  });
}

export async function markSlidesImagePending(slideIds: string[]) {
  if (slideIds.length === 0) {
    return;
  }

  await prisma.slide.updateMany({
    where: { id: { in: slideIds } },
    data: {
      imageStatus: SlideImageStatus.pending,
      imageError: null,
    },
  });
}

export async function markSlideImageFailed(slideId: string, message: string) {
  await prisma.slide.update({
    where: { id: slideId },
    data: {
      imageUrl: null,
      imageStatus: SlideImageStatus.failed,
      imageError: message,
    },
  });
}

export async function markSlideImageGenerated(slideId: string, imageUrl: string) {
  await prisma.slide.update({
    where: { id: slideId },
    data: {
      imageUrl,
      imageStatus: SlideImageStatus.generated,
      imageError: null,
    },
  });
}

export async function listSlidesForImageGeneration(
  deckId: string,
  workspaceId: string
) {
  const deck = await prisma.deckProject.findFirst({
    where: {
      id: deckId,
      workspaceId,
    },
    include: {
      slides: {
        orderBy: { order: 'asc' },
      },
    },
  });

  if (!deck) {
    return null;
  }

  return {
    ...deck,
    slides: deck.slides.map(serializeSlide),
  };
}

export async function createSlide(
  workspaceId: string,
  deckId: string,
  input: { title: string; subtitle?: string; bullets?: string[]; notes?: string; order?: number }
) {
  return prisma.$transaction(async (tx) => {
    const deck = await tx.deckProject.findFirst({
      where: {
        id: deckId,
        workspaceId,
      },
    });

    if (!deck) {
      throw new AppError({
        code: 'ARTICLE_NOT_FOUND',
        message: 'Article not found.',
        status: 404,
      });
    }

    const existingSlides = await tx.slide.findMany({
      where: { deckId },
      orderBy: { order: 'asc' },
    });

    const maxExistingOrder = existingSlides.length > 0
      ? Math.max(...existingSlides.map((s) => s.order))
      : -1;
    const appendOrder = maxExistingOrder + 1;
    const requestedOrder = input.order ?? appendOrder;
    const order = Math.min(Math.max(requestedOrder, 0), appendOrder);

    if (order <= maxExistingOrder) {
      const tempOffset = appendOrder + 1000;

      for (const slide of existingSlides.filter((slide) => slide.order >= order)) {
        await tx.slide.update({
          where: { id: slide.id },
          data: {
            order: slide.order + tempOffset,
          },
        });
      }

      for (const slide of existingSlides.filter((slide) => slide.order >= order)) {
        await tx.slide.update({
          where: { id: slide.id },
          data: {
            order: slide.order + 1,
          },
        });
      }
    }

    return tx.slide.create({
      data: {
        deckId,
        title: input.title,
        subtitle: input.subtitle,
        bullets: input.bullets ?? [],
        notes: input.notes,
        imageStatus: SlideImageStatus.pending,
        imageError: null,
        imagePrompt: null,
        order,
      },
    });
  });
}

export async function updateSlide(
  workspaceId: string,
  deckId: string,
  slideId: string,
  update: { title?: string; subtitle?: string; bullets?: string[]; notes?: string }
) {
  const slide = await prisma.slide.findFirst({
    where: {
      id: slideId,
      deckId,
      deck: {
        workspaceId,
      },
    },
  });

  if (!slide) {
    throw new AppError({
      code: 'SLIDE_NOT_FOUND',
      message: 'Slide not found.',
      status: 404,
    });
  }

  return prisma.slide.update({
    where: { id: slideId },
    data: {
      title: update.title,
      subtitle: update.subtitle,
      bullets: update.bullets,
      notes: update.notes,
    },
  });
}

export async function reorderSlides(
  workspaceId: string,
  deckId: string,
  slideOrder: Array<{ id: string; order: number }>
) {
  await prisma.$transaction(async (tx) => {
    const deck = await tx.deckProject.findFirst({
      where: {
        id: deckId,
        workspaceId,
      },
      include: {
        slides: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!deck) {
      throw new AppError({
        code: 'ARTICLE_NOT_FOUND',
        message: 'Article not found.',
        status: 404,
      });
    }

    if (slideOrder.length !== deck.slides.length) {
      throw new AppError({
        code: 'INVALID_SLIDE_ORDER',
        message: 'Slide reorder payload is incomplete.',
        status: 400,
      });
    }

    const deckSlideIds = new Set(deck.slides.map((slide) => slide.id));
    const requestedSlideIds = new Set(slideOrder.map((slide) => slide.id));

    if (deckSlideIds.size !== requestedSlideIds.size) {
      throw new AppError({
        code: 'INVALID_SLIDE_ORDER',
        message: 'Slide reorder payload is invalid.',
        status: 400,
      });
    }

    for (const slideId of requestedSlideIds) {
      if (!deckSlideIds.has(slideId)) {
        throw new AppError({
          code: 'INVALID_SLIDE_ORDER',
          message: 'Slide reorder payload references another article.',
          status: 400,
        });
      }
    }

    const requestedOrders = slideOrder
      .map((slide) => slide.order)
      .sort((left, right) => left - right);

    for (const [index, order] of requestedOrders.entries()) {
      if (order !== index) {
        throw new AppError({
          code: 'INVALID_SLIDE_ORDER',
          message: 'Slide reorder payload must be normalized.',
          status: 400,
        });
      }
    }

    const tempOffset = deck.slides.length + 1000;

    for (const item of slideOrder) {
      await tx.slide.update({
        where: { id: item.id },
        data: {
          order: item.order + tempOffset,
        },
      });
    }

    for (const item of slideOrder) {
      await tx.slide.update({
        where: { id: item.id },
        data: {
          order: item.order,
        },
      });
    }
  });
}

export async function deleteSlide(
  workspaceId: string,
  deckId: string,
  slideId: string
) {
  await prisma.$transaction(async (tx) => {
    const slide = await tx.slide.findFirst({
      where: {
        id: slideId,
        deckId,
        deck: {
          workspaceId,
        },
      },
    });

    if (!slide) {
      throw new AppError({
        code: 'SLIDE_NOT_FOUND',
        message: 'Slide not found.',
        status: 404,
      });
    }

    await tx.slide.delete({
      where: {
        id: slideId,
      },
    });

    const remainingSlides = await tx.slide.findMany({
      where: { deckId },
      orderBy: { order: 'asc' },
    });

    for (const [index, remainingSlide] of remainingSlides.entries()) {
      if (remainingSlide.order !== index) {
        await tx.slide.update({
          where: { id: remainingSlide.id },
          data: { order: index },
        });
      }
    }
  });
}

export async function createRenderAsset(
  deckId: string,
  filename: string,
  filePath: string,
  assetType: 'png' | 'pptx' | 'pdf',
  jobId?: string
) {
  return prisma.renderAsset.create({
    data: {
      deckId,
      filename,
      filePath,
      format: assetType,
      jobId,
      mimeType:
        assetType === 'pdf'
          ? 'application/pdf'
          : assetType === 'png'
            ? 'image/png'
            : 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    },
  });
}

export async function getRenderAssets(deckId: string) {
  return prisma.renderAsset.findMany({
    where: { deckId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getCaptions(deckId: string) {
  const captions = await prisma.captionPackage.findUnique({
    where: { deckId },
  });

  return serializeCaptions(captions);
}
