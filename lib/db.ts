import prisma from './prisma';
import { CreateDeckProjectInput, UpdateSlideInput } from './schemas';
import { GeneratedDeckResponse } from './gemini';
import { Slide, DeckProject } from '@prisma/client';

export async function createDeckProject(
  title: string,
  description?: string
): Promise<DeckProject> {
  return prisma.deckProject.create({
    data: {
      title,
      description,
    },
  });
}

export async function getDeckProject(id: string) {
  return prisma.deckProject.findUnique({
    where: { id },
    include: {
      slides: {
        orderBy: { order: 'asc' },
      },
      captions: true,
      renderAssets: true,
    },
  });
}

export async function updateDeckProject(
  id: string,
  data: Partial<{
    title: string;
    description: string;
    theme: string;
    status: string;
  }>
) {
  return prisma.deckProject.update({
    where: { id },
    data,
    include: {
      slides: {
        orderBy: { order: 'asc' },
      },
    },
  });
}

export async function listDeckProjects(limit = 10) {
  return prisma.deckProject.findMany({
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { slides: true },
      },
    },
  });
}

export async function createSlidesFromGeneration(
  deckId: string,
  generated: GeneratedDeckResponse
): Promise<Slide[]> {
  const slides = await Promise.all(
    generated.slides.map((slide) =>
      prisma.slide.create({
        data: {
          deckId,
          title: slide.title,
          subtitle: slide.subtitle,
          bulletPoints: slide.bulletPoints,
          notes: slide.notes,
          order: slide.order,
        },
      })
    )
  );

  // Store captions
  await prisma.captionPackage.upsert({
    where: { deckId },
    update: {
      blog: generated.captions.blog,
      twitter: generated.captions.twitter,
    },
    create: {
      deckId,
      blog: generated.captions.blog,
      twitter: generated.captions.twitter,
    },
  });

  return slides;
}

export async function updateSlide(
  slideId: string,
  update: SlideUpdateRequest
): Promise<Slide> {
  return prisma.slide.update({
    where: { id: slideId },
    data: {
      title: update.title,
      subtitle: update.subtitle,
      bulletPoints: update.bulletPoints,
      notes: update.notes,
    },
  });
}

export async function reorderSlides(
  deckId: string,
  slideOrder: Array<{ id: string; order: number }>
): Promise<void> {
  await Promise.all(
    slideOrder.map((item) =>
      prisma.slide.update({
        where: { id: item.id },
        data: { order: item.order },
      })
    )
  );
}

export async function deleteSlide(slideId: string): Promise<void> {
  await prisma.slide.delete({
    where: { id: slideId },
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
      assetType,
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

export async function getDeckWithAssets(deckId: string) {
  const deck = await prisma.deckProject.findUnique({
    where: { id: deckId },
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

  return deck;
}
