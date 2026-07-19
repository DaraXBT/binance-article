import { DeckStatus, type Prisma } from '@prisma/client';
import { FatalError } from 'workflow';

import { generateDeckWithGemini, normalizeGeminiError } from '@/lib/gemini';
import {
  assertImagePipelineReady,
  buildImagePrompt,
  generateImage,
  getStyleDescription,
  normalizeImageGenerationError,
  uploadToBlob,
} from '@/lib/image-gen';
import {
  listSlidesForImageGeneration,
  markDeckStatus,
  markSlideImageFailed,
  markSlideImageGenerated,
  markSlidesImagePending,
  replaceGeneratedContent,
} from '@/lib/db';
import { fetchArticleSourceText } from '@/server/integrations/url-fetch';
import { AppError } from '@/server/http/errors';
import { logEvent } from '@/server/http/log';
import { getJobRunById, appendJobLog, completeJobRun, failJobRun, markJobProgress, markJobRunning } from '@/server/modules/jobs/service';
import { type DeckGenerateRequest } from '@/lib/schemas';

type ImageGenerationMode = 'missing' | 'failed';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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

function buildAggregateImageResult(
  deckId: string,
  mode: ImageGenerationMode,
  results: SlideResult[]
) {
  const generated = results.filter((result) => result.status === 'generated').length;
  const failedResults = results.filter((result): result is FailedSlideResult => result.status === 'failed');
  const failed = failedResults.length;
  const total = results.length;
  const status = failed === 0 ? 'success' : generated === 0 ? 'failed' : 'partial';
  const firstFailed = failedResults[0];
  const uniqueErrorTypes = new Set(failedResults.map((result) => result.errorType));

  return {
    success: status === 'success',
    status,
    deckId,
    mode,
    total,
    generated,
    failed,
    results,
    errorSummary: firstFailed
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
      : undefined,
  };
}

function shouldProcessSlide(
  slide: { imageUrl: string | null; imageStatus: string },
  mode: ImageGenerationMode
) {
  if (mode === 'failed') {
    return slide.imageStatus === 'failed';
  }

  return !slide.imageUrl;
}

async function generateImagesForDeck(input: {
  jobId: string;
  deckId: string;
  workspaceId: string;
  illustrationStyle: string;
  mode: ImageGenerationMode;
}) {
  const deck = await listSlidesForImageGeneration(input.deckId, input.workspaceId);

  if (!deck) {
    throw new FatalError('Article not found.');
  }

  const targetSlides = deck.slides.filter((slide) => shouldProcessSlide(slide, input.mode));

  if (targetSlides.length === 0) {
    return buildAggregateImageResult(input.deckId, input.mode, []);
  }

  await markSlidesImagePending(
    input.workspaceId,
    input.deckId,
    targetSlides.map((slide) => slide.id),
  );

  try {
    assertImagePipelineReady();
  } catch (error) {
    const normalizedError = normalizeImageGenerationError(
      error,
      'Image pipeline is not configured'
    );
    const errorType = classifyImageError(normalizedError, 'preflight');
    const results = await Promise.all(
      targetSlides.map(async (slide) => {
        await markSlideImageFailed(
          input.workspaceId,
          input.deckId,
          slide.id,
          normalizedError.message,
        );
        return buildFailedSlideResult(slide.id, normalizedError, errorType);
      })
    );

    return buildAggregateImageResult(input.deckId, input.mode, results);
  }

  const styleDescription = getStyleDescription(input.illustrationStyle);
  const results: SlideResult[] = [];
  const total = targetSlides.length;
  const chunkSize = 4;

  for (let index = 0; index < targetSlides.length; index += chunkSize) {
    const chunk = targetSlides.slice(index, index + chunkSize);
    const chunkResults = await Promise.all(
      chunk.map(async (slide) => {
        if (!slide.imagePrompt) {
          const message = 'No image prompt found for this slide.';
          await markSlideImageFailed(input.workspaceId, input.deckId, slide.id, message);
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
          const filename = `decks/${input.deckId}/slide-${String(slide.order + 1).padStart(2, '0')}.${extension}`;
          const imageUrl = await uploadToBlob(
            imageResult.buffer,
            filename,
            imageResult.mimeType
          );

          await markSlideImageGenerated(
            input.workspaceId,
            input.deckId,
            slide.id,
            imageUrl,
          );

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

          await markSlideImageFailed(
            input.workspaceId,
            input.deckId,
            slide.id,
            normalizedError.message,
          );
          return buildFailedSlideResult(slide.id, normalizedError, errorType);
        }
      })
    );

    results.push(...chunkResults);

    const processed = Math.min(index + chunk.length, total);
    await markJobProgress(
      input.jobId,
      55 + Math.round((processed / total) * 40),
      'Generated slide images.',
      { processed, total }
    );
  }

  return buildAggregateImageResult(input.deckId, input.mode, results);
}

export async function handleArticleGenerationJob(jobId: string) {
  'use workflow';

  const job = await getJobRunById(jobId);

  if (!job || !isRecord(job.payload)) {
    throw new FatalError('Job payload not found.');
  }

  await markJobRunning(jobId);
  await appendJobLog(jobId, 'Started article generation workflow.');
  await markDeckStatus(job.deckId, job.workspaceId, DeckStatus.generating);

  logEvent('info', 'workflow.article_generation.start', { jobId, deckId: job.deckId });

  const payload = job.payload;

  try {
    await markJobProgress(jobId, 10, 'Preparing article content.');

    const mode = readString(payload.mode, 'text');
    const illustrationStyle = readString(payload.illustrationStyle, 'pixel-art');
    const slideCount = readNumber(payload.slideCount, 1);
    const rawArticleContent = readString(payload.articleContent);

    const articleContent =
      mode === 'url' ? await fetchArticleSourceText(rawArticleContent) : rawArticleContent;

    await markJobProgress(jobId, 25, 'Requesting Gemini slide generation.');

    const generated = await generateDeckWithGemini({
      articleContent,
      slideCount,
      illustrationStyle: illustrationStyle as DeckGenerateRequest['illustrationStyle'],
      mode: mode as 'text' | 'url' | 'prompt',
    });

    await markJobProgress(jobId, 45, 'Persisting generated slides and captions.');

    const replacement = await replaceGeneratedContent(
      job.deckId,
      job.workspaceId,
      job.articleRevisionId,
      generated
    );

    if (!replacement.applied) {
      await failJobRun(
        jobId,
        'STALE_REVISION',
        'A newer article generation was queued before this run finished.',
        'cancelled'
      );
      return;
    }

    const imageSummary = await generateImagesForDeck({
      jobId,
      deckId: job.deckId,
      workspaceId: job.workspaceId,
      illustrationStyle,
      mode: 'missing',
    });

    await completeJobRun(jobId, {
      deckId: job.deckId,
      slideCount: generated.slides.length,
      imageSummary,
    });

    logEvent('info', 'workflow.article_generation.complete', {
      jobId,
      deckId: job.deckId,
      slideCount: generated.slides.length,
      imageStatus: imageSummary.status,
    });
  } catch (error) {
    if (error instanceof AppError) {
      logEvent('error', 'workflow.article_generation.failed', { jobId, deckId: job.deckId, code: error.code, message: error.message });
      await markDeckStatus(job.deckId, job.workspaceId, DeckStatus.failed);
      await failJobRun(jobId, error.code, error.message);
      return;
    }

    const normalized = normalizeGeminiError(error, 'Failed to generate the article.');
    logEvent('error', 'workflow.article_generation.failed', { jobId, deckId: job.deckId, code: normalized.providerStatus || `GEMINI_${normalized.statusCode}`, message: normalized.message });
    await markDeckStatus(job.deckId, job.workspaceId, DeckStatus.failed);
    await failJobRun(jobId, normalized.providerStatus || `GEMINI_${normalized.statusCode}`, normalized.message);
  }
}

export async function handleArticleImageRetryJob(jobId: string) {
  'use workflow';

  const job = await getJobRunById(jobId);

  if (!job || !isRecord(job.payload)) {
    throw new FatalError('Job payload not found.');
  }

  await markJobRunning(jobId);
  await appendJobLog(jobId, 'Started image generation workflow.');

  logEvent('info', 'workflow.image_retry.start', { jobId, deckId: job.deckId });

  const payload = job.payload;
  const mode = readString(payload.mode, 'missing') as ImageGenerationMode;
  const illustrationStyle = readString(payload.illustrationStyle, 'pixel-art');

  try {
    await markJobProgress(jobId, 15, 'Preparing image generation.');

    const imageSummary = await generateImagesForDeck({
      jobId,
      deckId: job.deckId,
      workspaceId: job.workspaceId,
      illustrationStyle,
      mode,
    });

    if (imageSummary.status === 'failed') {
      await failJobRun(
        jobId,
        imageSummary.errorSummary?.type || 'IMAGE_GENERATION_FAILED',
        imageSummary.errorSummary?.message || 'Image generation failed.',
        'failed',
        imageSummary as Prisma.InputJsonValue
      );
      return;
    }

    await completeJobRun(jobId, imageSummary as Prisma.InputJsonValue);

    logEvent('info', 'workflow.image_retry.complete', {
      jobId,
      deckId: job.deckId,
      imageStatus: imageSummary.status,
      generated: imageSummary.generated,
      failed: imageSummary.failed,
    });
  } catch (error) {
    if (error instanceof AppError) {
      logEvent('error', 'workflow.image_retry.failed', { jobId, deckId: job.deckId, code: error.code, message: error.message });
      await failJobRun(jobId, error.code, error.message);
      return;
    }

    const normalized = normalizeImageGenerationError(error, 'Failed to generate images.');
    logEvent('error', 'workflow.image_retry.failed', { jobId, deckId: job.deckId, code: normalized.providerStatus || `IMAGE_${normalized.statusCode}`, message: normalized.message });
    await failJobRun(
      jobId,
      normalized.providerStatus || `IMAGE_${normalized.statusCode}`,
      normalized.message
    );
  }
}
