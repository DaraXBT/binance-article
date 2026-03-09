import { NextRequest, NextResponse } from 'next/server';
import { GenerateRequestSchema } from '@/lib/schemas';
import { generateDeckWithGemini, normalizeGeminiError } from '@/lib/gemini';
import { createSlidesFromGeneration, getDeckProject, updateDeckProject } from '@/lib/db';
import { getCurrentWorkspace } from '@/lib/workspace';

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspace } = await getCurrentWorkspace();
    const deckId = (await params).id;
    const body = await request.json();
    const validated = GenerateRequestSchema.parse(body);
    const existingDeck = await getDeckProject(deckId, workspace.id);

    if (!existingDeck) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }

    let contentToProcess = validated.articleContent;

    // If mode is URL, attempt to fetch the URL content
    if (validated.mode === 'url') {
      try {
        const urlRes = await fetch(validated.articleContent);
        if (urlRes.ok) {
          const html = await urlRes.text();
          // Extremely basic HTML to Text extraction
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
          const bodyText = bodyMatch ? bodyMatch[1] : html;
          // Strip script and style tags completely
          const cleanText = bodyText
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ') // Strip remaining HTML tags
            .replace(/\s+/g, ' ') // Collapse whitespace
            .trim();
          
          if (cleanText.length > 100) {
            contentToProcess = cleanText;
          }
        }
      } catch (err) {
        console.warn('Failed to fetch/parse URL content:', err);
        // Fallback to sending the URL itself; Gemini might handle it or complain
      }
    }

    // Generate content with Gemini
    const generated = await generateDeckWithGemini({
      articleContent: contentToProcess,
      slideCount: validated.slideCount,
      illustrationStyle: validated.illustrationStyle,
      mode: validated.mode,
    });

    // Save slides and captions to database
    await createSlidesFromGeneration(deckId, workspace.id, generated);

    // Update deck status
    await updateDeckProject(deckId, workspace.id, {
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
    const normalizedError = normalizeGeminiError(error, 'Failed to generate deck');

    return NextResponse.json(
      {
        error: normalizedError.message,
        code: normalizedError.providerCode,
        retryAfterSeconds: normalizedError.retryAfterSeconds,
        model: normalizedError.model,
      },
      { status: normalizedError.statusCode }
    );
  }
}
