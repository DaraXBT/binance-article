import { NextRequest, NextResponse } from 'next/server';
import { GenerateRequestSchema } from '@/lib/schemas';
import { generateDeckWithGemini } from '@/lib/gemini';
import { createSlidesFromGeneration, updateDeckProject } from '@/lib/db';

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const deckId = (await params).id;
    const body = await request.json();
    const validated = GenerateRequestSchema.parse(body);

    // Generate content with Gemini
    const generated = await generateDeckWithGemini({
      articleContent: validated.articleContent,
      slideCount: validated.slideCount,
      illustrationStyle: validated.illustrationStyle,
    });

    // Save slides and captions to database
    await createSlidesFromGeneration(deckId, generated);

    // Update deck status
    await updateDeckProject(deckId, {
      status: 'generated',
    });

    return NextResponse.json({
      success: true,
      deckId,
      slideCount: generated.slides.length,
      metadata: generated.metadata,
    });
  } catch (error) {
    console.error('[API] Error generating deck:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to generate deck',
      },
      { status: 400 }
    );
  }
}
