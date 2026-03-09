import { NextRequest, NextResponse } from 'next/server';
import {
  getDeckProject,
  markSlideImageFailed,
  markSlideImageGenerated,
  markSlidesImagePending,
} from '@/lib/db';
import { GenerateImagesRequestSchema, type ImageGenerationMode } from '@/lib/schemas';
import { getCurrentWorkspace } from '@/lib/workspace';
import {
  assertImagePipelineReady,
  buildImagePrompt,
  generateImage,
  getStyleDescription,
  normalizeImageGenerationError,
  uploadToBlob,
} from '@/lib/image-gen';

// Allow up to 60 seconds for image generation
export const maxDuration = 60;

type SlideRecord = {
  id: string;
  order: number;
  imageUrl: string | null;
  imagePrompt: string | null;
  imageStatus: string;
  imageError: string | null;
};

type DeckWithSlides = {
  id: string;
  slides: SlideRecord[];
};
type ImageErrorType = 'quota_exceeded' | 'configuration' | 'unknown';
type AggregateImageErrorType = ImageErrorType | 'mixed';

type GeneratedSlideResult = {
  slideId: string;
  status: 'generated';
  imageUrl: string;
  error: null;
};

type FailedSlideResult = {
  slideId: string;
  status: 'failed';
  imageUrl: null;
  error: string;
  errorType: ImageErrorType;
  providerCode?: number;
  providerStatus?: string;
  retryAfterSeconds?: number;
  model?: string;
};

type SlideResult = GeneratedSlideResult | FailedSlideResult;

async function getDeckWithSlides(deckId: string, workspaceId: string): Promise<DeckWithSlides | null> {
  const deck = (await getDeckProject(deckId, workspaceId)) as DeckWithSlides | null;

  if (!deck) {
    return null;
  }

  return deck;
}

function shouldProcessSlide(slide: SlideRecord, mode: ImageGenerationMode) {
  if (mode === 'failed') {
    return slide.imageStatus === 'failed';
  }

  return !slide.imageUrl;
}

async function markSlidesPending(slides: SlideRecord[]) {
  await markSlidesImagePending(slides.map((slide) => slide.id));
}

function classifyImageError(
  error: ReturnType<typeof normalizeImageGenerationError>,
  context: 'preflight' | 'slide' = 'slide'
): ImageErrorType {
  if (error.statusCode === 429 || error.providerCode === 429 || error.providerStatus === 'RESOURCE_EXHAUSTED') {
    return 'quota_exceeded';
  }

  if (context === 'preflight' || error.providerStatus === 'FAILED_PRECONDITION') {
    return 'configuration';
  }

  if (/not set|not configured|configuration|configured|empty value|blob upload returned/i.test(error.message)) {
    return 'configuration';
  }

  return 'unknown';
}

function buildFailedSlideResult(
  slideId: string,
  error: ReturnType<typeof normalizeImageGenerationError>,
  errorType: ImageErrorType
): FailedSlideResult {
  return {
    slideId,
    status: 'failed',
    imageUrl: null,
    error: error.message,
    errorType,
    providerCode: error.providerCode,
    providerStatus: error.providerStatus,
    retryAfterSeconds: error.retryAfterSeconds,
    model: error.model,
  };
}

async function markSlidesFailed(
  slides: SlideRecord[],
  error: ReturnType<typeof normalizeImageGenerationError>
): Promise<FailedSlideResult[]> {
  const errorType = classifyImageError(error, 'preflight');

  await Promise.all(slides.map((slide) => markSlideImageFailed(slide.id, error.message)));

  return slides.map((slide) => buildFailedSlideResult(slide.id, error, errorType));
}

function buildAggregateResponse(
  deckId: string,
  mode: ImageGenerationMode,
  results: SlideResult[]
) {
  const generated = results.filter((result) => result.status === 'generated').length;
  const failedResults = results.filter((result): result is FailedSlideResult => result.status === 'failed');
  const failed = failedResults.length;
  const total = results.length;

  const status =
    failed === 0 ? 'success' : generated === 0 ? 'failed' : 'partial';

  const firstFailed = failedResults[0];
  const uniqueErrorTypes = new Set(failedResults.map((result) => result.errorType));
  const errorSummary = firstFailed
    ? {
        type:
          uniqueErrorTypes.size === 1
            ? firstFailed.errorType
            : ('mixed' as AggregateImageErrorType),
        message:
          uniqueErrorTypes.size === 1
            ? firstFailed.error
            : 'Multiple image generation errors occurred. Retry failed images from the article page for details.',
        providerCode: uniqueErrorTypes.size === 1 ? firstFailed.providerCode : undefined,
        providerStatus: uniqueErrorTypes.size === 1 ? firstFailed.providerStatus : undefined,
        retryAfterSeconds: uniqueErrorTypes.size === 1 ? firstFailed.retryAfterSeconds : undefined,
        model: uniqueErrorTypes.size === 1 ? firstFailed.model : undefined,
      }
    : undefined;

  return {
    success: status === 'success',
    status,
    deckId,
    mode,
    total,
    generated,
    failed,
    results,
    errorSummary,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspace } = await getCurrentWorkspace();
    const deckId = (await params).id;
    const body = await request.json().catch(() => ({}));
    const validated = GenerateImagesRequestSchema.parse(body);

    const deck = await getDeckWithSlides(deckId, workspace.id);

    if (!deck) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }

    const targetSlides = deck.slides.filter((slide) => shouldProcessSlide(slide, validated.mode));

    if (targetSlides.length === 0) {
      return NextResponse.json(
        buildAggregateResponse(deckId, validated.mode, [])
      );
    }

    await markSlidesPending(targetSlides);

    try {
      assertImagePipelineReady();
    } catch (error) {
      const normalizedError = normalizeImageGenerationError(
        error,
        'Image pipeline is not configured'
      );
      const results = await markSlidesFailed(targetSlides, normalizedError);

      return NextResponse.json(
        buildAggregateResponse(deckId, validated.mode, results)
      );
    }

    const styleDescription = getStyleDescription(validated.illustrationStyle);
    const results: SlideResult[] = [];

    const CHUNK_SIZE = 5;
    for (let i = 0; i < targetSlides.length; i += CHUNK_SIZE) {
      const chunk = targetSlides.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.all(
        chunk.map(async (slide) => {
          if (!slide.imagePrompt) {
            const message = 'No image prompt found for this slide';
            await markSlideImageFailed(slide.id, message);

            return {
              slideId: slide.id,
              status: 'failed' as const,
              imageUrl: null,
              error: message,
              errorType: 'unknown' as const,
            };
          }

          try {
            const fullPrompt = buildImagePrompt(styleDescription, slide.imagePrompt);
            const imageResult = await generateImage(fullPrompt);
            const extension = imageResult.mimeType === 'image/jpeg' ? 'jpg' : 'png';
            const filename = `decks/${deckId}/slide-${String(slide.order + 1).padStart(2, '0')}.${extension}`;
            const imageUrl = await uploadToBlob(
              imageResult.buffer,
              filename,
              imageResult.mimeType
            );

            await markSlideImageGenerated(slide.id, imageUrl);

            return {
              slideId: slide.id,
              status: 'generated' as const,
              imageUrl,
              error: null,
            };
          } catch (error) {
            const normalizedError = normalizeImageGenerationError(
              error,
              'Unknown image generation error'
            );
            const errorType = classifyImageError(normalizedError);

            await markSlideImageFailed(slide.id, normalizedError.message);

            return buildFailedSlideResult(slide.id, normalizedError, errorType);
          }
        })
      );

      results.push(...chunkResults);
    }

    return NextResponse.json(buildAggregateResponse(deckId, validated.mode, results));
  } catch (error) {
    console.error('[API] Error generating images:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate images' },
      { status: 500 }
    );
  }
}
