import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  generateImage,
  getStyleDescription,
  uploadToBlob,
  buildImagePrompt,
} from '@/lib/image-gen';

// Allow up to 60 seconds for image generation
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const deckId = (await params).id;
    const body = await request.json();
    const illustrationStyle = body.illustrationStyle || 'pixel-art';

    // Get deck with slides
    const deck = await prisma.deckProject.findUnique({
      where: { id: deckId },
      include: {
        slides: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!deck) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }

    // Get embedded style description (no filesystem needed)
    const styleDescription = getStyleDescription(illustrationStyle);

    // Generate images for each slide
    const results: { slideId: string; imageUrl: string | null; error?: string }[] = [];

    for (const slide of deck.slides) {
      if (!slide.imagePrompt) {
        results.push({ slideId: slide.id, imageUrl: null, error: 'No image prompt' });
        continue;
      }

      try {
        const fullPrompt = buildImagePrompt(styleDescription, slide.imagePrompt);

        console.log(`[ImageGen] Generating image for slide ${slide.order + 1}...`);

        // Generate image via Google Gemini
        const imageBuffer = await generateImage(fullPrompt);

        if (!imageBuffer) {
          console.warn(`[ImageGen] No image returned for slide ${slide.order + 1}`);
          results.push({ slideId: slide.id, imageUrl: null, error: 'No image generated' });
          continue;
        }

        // Upload to Vercel Blob
        const filename = `decks/${deckId}/slide-${String(slide.order + 1).padStart(2, '0')}.png`;
        const imageUrl = await uploadToBlob(imageBuffer, filename);

        // Update slide with image URL
        await prisma.slide.update({
          where: { id: slide.id },
          data: { imageUrl },
        });

        results.push({ slideId: slide.id, imageUrl });
        console.log(`[ImageGen] ✅ Slide ${slide.order + 1} uploaded: ${imageUrl}`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[ImageGen] ❌ Slide ${slide.order + 1} failed:`, errorMsg);
        results.push({ slideId: slide.id, imageUrl: null, error: errorMsg });
      }
    }

    const successCount = results.filter((r) => r.imageUrl).length;

    return NextResponse.json({
      success: true,
      deckId,
      generated: successCount,
      total: deck.slides.length,
      results,
    });
  } catch (error) {
    console.error('[API] Error generating images:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate images' },
      { status: 500 }
    );
  }
}
