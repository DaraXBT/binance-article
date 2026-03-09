import prisma from './prisma';
import { CreateDeckProjectInput, UpdateSlideInput, SlideUpdateRequest } from './schemas';
import { GeneratedDeckResponse } from './gemini';
import { Slide, DeckProject } from '@prisma/client';

export async function createDeckProject(
  title: string,
  content: string,
  description?: string,
  illustrationStyle?: string,
  sessionId?: string
): Promise<DeckProject> {
  return prisma.deckProject.create({
    data: {
      title,
      content,
      description,
      illustrationStyle: illustrationStyle || 'pixel-art',
      sessionId: sessionId || '',
    },
  });
}

export async function getDeckProject(id: string) {
  const deck = await prisma.deckProject.findUnique({
    where: { id },
    include: {
      slides: {
        orderBy: { order: 'asc' },
      },
      captions: true,
      renderAssets: true,
    },
  });

  if (!deck) return null;

  return {
    ...deck,
    slides: deck.slides.map((slide: any) => ({
      ...slide,
      bulletPoints: slide.bullets ? JSON.parse(slide.bullets) : [],
    }))
  };
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
  const deck = await prisma.deckProject.update({
    where: { id },
    data,
    include: {
      slides: {
        orderBy: { order: 'asc' },
      },
    },
  });

  return {
    ...deck,
    slides: deck.slides.map((slide: any) => ({
      ...slide,
      bulletPoints: slide.bullets ? JSON.parse(slide.bullets) : [],
    }))
  };
}

export async function listDeckProjects(sessionId: string, limit = 10) {
  return prisma.deckProject.findMany({
    where: { sessionId },
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
          bullets: JSON.stringify(slide.bulletPoints || []),
          notes: slide.notes,
          imagePrompt: slide.imagePrompt || null,
          order: slide.order,
        },
      })
    )
  );

  // Store captions
  await prisma.captionPackage.upsert({
    where: { deckId },
    update: {
      blogTitle: generated.captions.blog?.seoTitle,
      blogMeta: generated.captions.blog?.metaDescription,
      blogIntro: generated.captions.blog?.introText,
      blogSections: generated.captions.blog?.sections ? JSON.stringify(generated.captions.blog.sections) : null,
      blogTags: generated.captions.blog?.tags ? JSON.stringify(generated.captions.blog.tags) : null,
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
      blogSections: generated.captions.blog?.sections ? JSON.stringify(generated.captions.blog.sections) : null,
      blogTags: generated.captions.blog?.tags ? JSON.stringify(generated.captions.blog.tags) : null,
      xSingle1: generated.captions.twitter?.singles?.[0],
      xSingle2: generated.captions.twitter?.singles?.[1],
      xSingle3: generated.captions.twitter?.singles?.[2],
      xThread: generated.captions.twitter?.thread,
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
      bullets: update.bullets ? JSON.stringify(update.bullets) : undefined,
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
      format: assetType,
      mimeType: assetType === 'pdf' ? 'application/pdf' : assetType === 'png' ? 'image/png' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
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

  if (!deck) return null;

  return {
    ...deck,
    slides: deck.slides.map((slide: any) => ({
      ...slide,
      bulletPoints: slide.bullets ? JSON.parse(slide.bullets) : [],
    }))
  };
}
