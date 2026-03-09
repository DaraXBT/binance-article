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

    // Generate images for each slide in parallel chunks to avoid Vercel 60s timeout
    const results: { slideId: string; imageUrl: string | null; error?: string }[] = [];
    
    const CHUNK_SIZE = 5;
    for (let i = 0; i < deck.slides.length; i += CHUNK_SIZE) {
      const chunk = deck.slides.slice(i, i + CHUNK_SIZE);
      
      const chunkPromises = chunk.map(async (slide) => {
        if (!slide.imagePrompt) {
          return { slideId: slide.id, imageUrl: null, error: 'No image prompt' };
        }

        try {
          const fullPrompt = buildImagePrompt(styleDescription, slide.imagePrompt);

          console.log(`[ImageGen] Generating image for slide ${slide.order + 1}...`);

          // Generate image via Google Gemini
          const imageResult = await generateImage(fullPrompt);

          if (!imageResult) {
            console.warn(`[ImageGen] No image returned for slide ${slide.order + 1}`);
            return { slideId: slide.id, imageUrl: null, error: 'No image generated' };
          }

          // Upload to Vercel Blob
          const ext = imageResult.mimeType === 'image/jpeg' ? 'jpg' : 'png';
          const filename = `decks/${deckId}/slide-${String(slide.order + 1).padStart(2, '0')}.${ext}`;
          const imageUrl = await uploadToBlob(imageResult.buffer, filename, imageResult.mimeType);

          // Update slide with image URL
          await prisma.slide.update({
            where: { id: slide.id },
            data: { imageUrl },
          });

          console.log(`[ImageGen] ✅ Slide ${slide.order + 1} uploaded: ${imageUrl}`);
          return { slideId: slide.id, imageUrl };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          console.error(`[ImageGen] ❌ Slide ${slide.order + 1} failed:`, errorMsg);
          return { slideId: slide.id, imageUrl: null, error: errorMsg };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
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
