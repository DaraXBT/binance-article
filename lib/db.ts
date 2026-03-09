import { DeckProject, Slide } from '@prisma/client';

import { GeneratedDeckResponse } from '@/lib/gemini';
import prisma from '@/lib/prisma';
import { CreateSlideInput, SlideUpdateRequest } from '@/lib/schemas';

function withParsedBullets<T extends { slides: Array<Slide> }>(deck: T) {
  return {
    ...deck,
    slides: deck.slides.map((slide: Slide) => ({
      ...slide,
      bulletPoints: slide.bullets ? JSON.parse(slide.bullets) : [],
    })),
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
    throw new Error('Deck not found');
  }

  return deck;
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

  return withParsedBullets(deck);
}

export async function markSlidesImagePending(slideIds: string[]) {
  await Promise.all(
    slideIds.map((id) =>
      prisma.slide.update({
        where: { id },
        data: {
          imageStatus: 'pending',
          imageError: null,
        },
      })
    )
  );
}

export async function markSlideImageFailed(slideId: string, message: string) {
  await prisma.slide.update({
    where: { id: slideId },
    data: {
      imageUrl: null,
      imageStatus: 'failed',
      imageError: message,
    },
  });
}

export async function markSlideImageGenerated(slideId: string, imageUrl: string) {
  await prisma.slide.update({
    where: { id: slideId },
    data: {
      imageUrl,
      imageStatus: 'generated',
      imageError: null,
    },
  });
}

export async function getDeckWithAssets(deckId: string, workspaceId: string) {
  const deck = await prisma.deckProject.findFirst({
    where: {
      id: deckId,
      workspaceId,
    },
    include: {
      slides: {
        orderBy: { order: 'asc' },
      },
      captions: true,
      renderAssets: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!deck) {
    return null;
  }

  return withParsedBullets(deck);
}

export async function updateDeckProject(
  id: string,
  workspaceId: string,
  data: Partial<{
    title: string;
    description: string;
    theme: string;
    status: string;
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

  return withParsedBullets(deck);
}

export async function deleteDeckProject(id: string, workspaceId: string) {
  await ensureDeck(workspaceId, id);

  return prisma.deckProject.delete({
    where: { id },
  });
}

export async function createSlidesFromGeneration(
  deckId: string,
  workspaceId: string,
  generated: GeneratedDeckResponse
): Promise<Slide[]> {
  await ensureDeck(workspaceId, deckId);

  const slides = await Promise.all(
    generated.slides.map((slide) =>
      prisma.slide.create({
        data: {
          deckId,
          title: slide.title,
          subtitle: slide.subtitle,
          bullets: JSON.stringify(slide.bulletPoints || []),
          notes: slide.notes,
          imageStatus: 'pending',
          imageError: null,
          imagePrompt: slide.imagePrompt || null,
          order: slide.order,
        },
      })
    )
  );

  await prisma.captionPackage.upsert({
    where: { deckId },
    update: {
      blogTitle: generated.captions.blog?.seoTitle,
      blogMeta: generated.captions.blog?.metaDescription,
      blogIntro: generated.captions.blog?.introText,
      blogSections: generated.captions.blog?.sections
        ? JSON.stringify(generated.captions.blog.sections)
        : null,
      blogTags: generated.captions.blog?.tags
        ? JSON.stringify(generated.captions.blog.tags)
        : null,
      xSingle1: generated.captions.twitter?.singles?.[0],
      xSingle2: generated.captions.twitter?.singles?.[1],
      xSingle3: generated.captions.twitter?.singles?.[2],
      xThread: generated.captions.twitter?.thread,
    },
    create: {
      deckId,
      blogTitle: generated.captions.blog?.seoTitle,
      blogMeta: generated.captions.blog?.metaDescription,
      blogIntro: generated.captions.blog?.introText,
      blogSections: generated.captions.blog?.sections
        ? JSON.stringify(generated.captions.blog.sections)
        : null,
      blogTags: generated.captions.blog?.tags
        ? JSON.stringify(generated.captions.blog.tags)
        : null,
      xSingle1: generated.captions.twitter?.singles?.[0],
      xSingle2: generated.captions.twitter?.singles?.[1],
      xSingle3: generated.captions.twitter?.singles?.[2],
      xThread: generated.captions.twitter?.thread,
    },
  });

  return slides;
}

export async function createSlide(
  workspaceId: string,
  deckId: string,
  input: Omit<CreateSlideInput, 'order'> & { order?: number }
) {
  return prisma.$transaction(async (tx) => {
    const deck = await tx.deckProject.findFirst({
      where: {
        id: deckId,
        workspaceId,
      },
    });

    if (!deck) {
      throw new Error('Deck not found');
    }

    const existingSlides = await tx.slide.findMany({
      where: { deckId },
      orderBy: { order: 'asc' },
    });

    const requestedOrder = input.order ?? existingSlides.length;
    const order = Math.min(Math.max(requestedOrder, 0), existingSlides.length);

    if (order < existingSlides.length) {
      const tempOffset = existingSlides.length + 1000;

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
        bullets: JSON.stringify(input.bullets ?? []),
        notes: input.notes,
        imageStatus: 'pending',
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
  update: SlideUpdateRequest
): Promise<Slide> {
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
    throw new Error('Slide not found');
  }

  return prisma.slide.update({
    where: { id: slideId },
    data: {
      title: update.title,
      subtitle: update.subtitle,
      bullets: update.bullets ? JSON.stringify(update.bullets) : undefined,
      notes: update.notes,
    },
  });
}

export async function reorderSlides(
  workspaceId: string,
  deckId: string,
  slideOrder: Array<{ id: string; order: number }>
): Promise<void> {
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
      throw new Error('Deck not found');
    }

    if (slideOrder.length !== deck.slides.length) {
      throw new Error('Slide reorder payload is incomplete');
    }

    const deckSlideIds = new Set(deck.slides.map((slide) => slide.id));
    const requestedSlideIds = new Set(slideOrder.map((slide) => slide.id));

    if (deckSlideIds.size !== requestedSlideIds.size) {
      throw new Error('Slide reorder payload is invalid');
    }

    for (const slideId of requestedSlideIds) {
      if (!deckSlideIds.has(slideId)) {
        throw new Error('Slide reorder payload references another deck');
      }
    }

    const requestedOrders = slideOrder
      .map((slide) => slide.order)
      .sort((left, right) => left - right);

    for (const [index, order] of requestedOrders.entries()) {
      if (order !== index) {
        throw new Error('Slide reorder payload must be normalized');
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
): Promise<void> {
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
      throw new Error('Slide not found');
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
  assetType: 'png' | 'pptx' | 'pdf'
) {
  return prisma.renderAsset.create({
    data: {
      deckId,
      filename,
      filePath,
      format: assetType,
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
  return prisma.captionPackage.findUnique({
    where: { deckId },
  });
}
