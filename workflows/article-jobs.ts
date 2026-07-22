import { generateDeckWithProvider, normalizeGeminiError } from '@/lib/gemini';
import { buildArticleCoverPrompt } from '@/lib/article-cover';
import {
  assertImagePipelineReady,
  buildImagePrompt,
  generateImage,
  normalizeImageGenerationError,
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
import { getArticleAssetsBucket } from '@/server/cloudflare/article-assets';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { AppError } from '@/server/http/app-error';
import { logEvent } from '@/server/http/log';
import { createArticleAssetRepository } from '@/server/modules/assets/repository';
import type { ArticleAssetBucket } from '@/server/modules/assets/service';
import { storeArticleAsset } from '@/server/modules/assets/service';
import { getJobRunById, appendJobLog, completeJobRun, failJobRun, markJobProgress, markJobRunning } from '@/server/modules/jobs/service';
import { IllustrationStyleSchema } from '@/lib/schemas';
import {
  DEFAULT_ILLUSTRATION_STYLE,
  type IllustrationStyleId,
} from '@/lib/config';
import { TextProviderError, TextProviderSchema } from '@/server/integrations/text-provider';
import { createArticleCoverRepository } from '@/server/modules/covers/repository';
import {
  initializeArticleCover,
  markArticleCoverFailed,
  markArticleCoverGenerated,
} from '@/server/modules/covers/service';

type ImageGenerationMode = 'missing' | 'failed';
type ImageErrorType = 'quota_exceeded' | 'configuration' | 'unknown';
type AggregateImageErrorType = ImageErrorType | 'mixed';

export class NonRetryableArticleJobError extends Error {}

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

type CoverResult =
  | { status: 'generated'; imageUrl: string; error: null }
  | {
      status: 'failed';
      imageUrl: null;
      error: string;
      errorType: ImageErrorType;
      providerCode?: number;
      providerStatus?: string;
      retryAfterSeconds?: number;
      model?: string;
    }
  | { status: 'skipped'; imageUrl: null; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readIllustrationStyle(value: unknown): IllustrationStyleId {
  const parsed = IllustrationStyleSchema.safeParse(value ?? DEFAULT_ILLUSTRATION_STYLE);
  if (!parsed.success) {
    throw new NonRetryableArticleJobError('Invalid illustration style in job payload.');
  }
  return parsed.data;
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
  illustrationStyle: IllustrationStyleId;
  mode: ImageGenerationMode;
  assetBucket?: ArticleAssetBucket;
}) {
  const deck = await listSlidesForImageGeneration(input.deckId, input.workspaceId);

  if (!deck) {
    throw new NonRetryableArticleJobError('Article not found.');
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

  const results: SlideResult[] = [];
  const total = targetSlides.length;
  const chunkSize = 4;

  for (let index = 0; index < targetSlides.length; index += chunkSize) {
    if ((await getJobRunById(input.jobId))?.status !== 'running') break;
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
          const fullPrompt = buildImagePrompt(input.illustrationStyle, slide.imagePrompt);
          const imageResult = await generateImage(fullPrompt);
          const extension = imageResult.mimeType === 'image/jpeg' ? 'jpg' : 'png';
          const filename = `slide-${String(slide.order + 1).padStart(2, '0')}.${extension}`;
          const storedAsset = await storeArticleAsset({
            repository: createArticleAssetRepository(getRuntimeDatabase()),
            bucket: input.assetBucket ?? getArticleAssetsBucket(),
            workspaceId: input.workspaceId,
            articleId: input.deckId,
            slideId: slide.id,
            filename,
            mimeType: imageResult.mimeType,
            bytes: imageResult.buffer,
          });
          const imageUrl = storedAsset.reference;

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

export async function generateCoverForDeck(input: {
  deckId: string;
  workspaceId: string;
  illustrationStyle: IllustrationStyleId;
  assetBucket?: ArticleAssetBucket;
}): Promise<CoverResult> {
  const database = getRuntimeDatabase();
  const coverRepository = createArticleCoverRepository(database);
  let generationRevision: number | null = null;

  try {
    const deck = await listSlidesForImageGeneration(input.deckId, input.workspaceId);
    if (!deck) {
      return { status: 'skipped', imageUrl: null, error: 'Article not found.' };
    }
    generationRevision = deck.generationRevision;

    const coverPrompt = buildArticleCoverPrompt({
      title: deck.title,
      description: deck.description,
      content: deck.content,
      style: input.illustrationStyle,
      slides: deck.slides.map((slide) => ({
        title: slide.title,
        subtitle: slide.subtitle,
        bullets: slide.bullets,
      })),
    });
    const initialized = await initializeArticleCover({
      repository: coverRepository,
      workspaceId: input.workspaceId,
      articleId: input.deckId,
      generationRevision: deck.generationRevision,
      style: input.illustrationStyle,
      styleMode: coverPrompt.styleMode,
      prompt: coverPrompt.prompt,
    });
    if (!initialized) {
      return {
        status: 'skipped',
        imageUrl: null,
        error: 'A newer article revision replaced this cover request.',
      };
    }

    const pipeline = assertImagePipelineReady();
    const imageResult = await generateImage(coverPrompt.prompt, pipeline, {
      aspectRatio: '21:9',
      imageSize: '2K',
    });
    const extension = imageResult.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const filename = `cover-source.${extension}`;
    const storedAsset = await storeArticleAsset({
      repository: createArticleAssetRepository(database),
      bucket: input.assetBucket ?? getArticleAssetsBucket(),
      workspaceId: input.workspaceId,
      articleId: input.deckId,
      purpose: 'cover_image',
      assetScope: `rev-${deck.generationRevision}`,
      filename,
      mimeType: imageResult.mimeType,
      bytes: imageResult.buffer,
    });
    const generated = await markArticleCoverGenerated({
      repository: coverRepository,
      workspaceId: input.workspaceId,
      articleId: input.deckId,
      generationRevision: deck.generationRevision,
      sourceAssetId: storedAsset.assetId,
    });
    if (!generated) {
      return {
        status: 'skipped',
        imageUrl: null,
        error: 'A newer article revision replaced this generated cover.',
      };
    }
    return { status: 'generated', imageUrl: storedAsset.reference, error: null };
  } catch (error) {
    const normalizedError = normalizeImageGenerationError(
      error,
      'The dedicated article cover could not be generated.',
    );
    const errorType = classifyImageError(normalizedError);
    if (generationRevision !== null) {
      await markArticleCoverFailed({
        repository: coverRepository,
        workspaceId: input.workspaceId,
        articleId: input.deckId,
        generationRevision,
        error: normalizedError.message,
      }).catch(() => null);
    }
    return {
      status: 'failed',
      imageUrl: null,
      error: normalizedError.message,
      errorType,
      providerCode: normalizedError.providerCode,
      providerStatus: normalizedError.providerStatus,
      retryAfterSeconds: normalizedError.retryAfterSeconds,
      model: normalizedError.model,
    };
  }
}

export async function handleArticleGenerationJob(
  jobId: string,
  providerEnvironment: Record<string, string | undefined> = process.env,
  runtime: { assetBucket?: ArticleAssetBucket } = {},
) {
  const existingJob = await getJobRunById(jobId);

  if (!existingJob || !isRecord(existingJob.payload)) {
    throw new NonRetryableArticleJobError('Job payload not found.');
  }

  const job = await markJobRunning(jobId) ?? await getJobRunById(jobId);
  if (!job || job.status !== 'running') return;
  if (!isRecord(job.payload)) {
    throw new NonRetryableArticleJobError('Job payload not found.');
  }
  await appendJobLog(jobId, 'Started article generation workflow.');
  await markDeckStatus(job.deckId, job.workspaceId, 'generating');

  logEvent('info', 'workflow.article_generation.start', { jobId, deckId: job.deckId });

  const payload = job.payload;

  try {
    await markJobProgress(jobId, 10, 'Preparing article content.');

    const mode = readString(payload.mode, 'text');
    const illustrationStyle = readIllustrationStyle(payload.illustrationStyle);
    const slideCount = readNumber(payload.slideCount, 1);
    const rawArticleContent = readString(payload.articleContent);
    const textProvider = TextProviderSchema.parse(readString(payload.textProvider, 'gemini'));

    const articleContent =
      mode === 'url' ? await fetchArticleSourceText(rawArticleContent) : rawArticleContent;

    await markJobProgress(jobId, 25, `Requesting ${textProvider} slide generation.`);

    const generated = await generateDeckWithProvider({
      articleContent,
      slideCount,
      illustrationStyle,
      mode: mode as 'text' | 'url' | 'prompt',
    }, textProvider, providerEnvironment);

    if ((await getJobRunById(jobId))?.status !== 'running') return;

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

    const [imageSummary, coverSummary] = await Promise.all([
      generateImagesForDeck({
        jobId,
        deckId: job.deckId,
        workspaceId: job.workspaceId,
        illustrationStyle,
        mode: 'missing',
        assetBucket: runtime.assetBucket,
      }),
      generateCoverForDeck({
        deckId: job.deckId,
        workspaceId: job.workspaceId,
        illustrationStyle,
        assetBucket: runtime.assetBucket,
      }),
    ]);

    await completeJobRun(jobId, {
      deckId: job.deckId,
      slideCount: generated.slides.length,
      imageSummary,
      coverSummary,
    });

    logEvent('info', 'workflow.article_generation.complete', {
      jobId,
      deckId: job.deckId,
      slideCount: generated.slides.length,
      imageStatus: imageSummary.status,
      coverStatus: coverSummary.status,
    });
  } catch (error) {
    if (error instanceof NonRetryableArticleJobError) {
      logEvent('error', 'workflow.article_generation.failed', {
        jobId,
        deckId: job.deckId,
        code: 'INVALID_JOB_PAYLOAD',
        message: error.message,
      });
      await markDeckStatus(job.deckId, job.workspaceId, 'failed');
      await failJobRun(jobId, 'INVALID_JOB_PAYLOAD', error.message);
      return;
    }

    if (error instanceof AppError) {
      logEvent('error', 'workflow.article_generation.failed', { jobId, deckId: job.deckId, code: error.code, message: error.message });
      await markDeckStatus(job.deckId, job.workspaceId, 'failed');
      await failJobRun(jobId, error.code, error.message);
      return;
    }

    if (error instanceof TextProviderError) {
      const code = `${error.provider.toUpperCase()}_${error.statusCode}`;
      logEvent('error', 'workflow.article_generation.failed', { jobId, deckId: job.deckId, code, message: error.message });
      await markDeckStatus(job.deckId, job.workspaceId, 'failed');
      await failJobRun(jobId, code, error.message);
      return;
    }

    const normalized = normalizeGeminiError(error, 'Failed to generate the article.');
    logEvent('error', 'workflow.article_generation.failed', { jobId, deckId: job.deckId, code: normalized.providerStatus || `GEMINI_${normalized.statusCode}`, message: normalized.message });
    await markDeckStatus(job.deckId, job.workspaceId, 'failed');
    await failJobRun(jobId, normalized.providerStatus || `GEMINI_${normalized.statusCode}`, normalized.message);
  }
}

export async function handleArticleImageRetryJob(
  jobId: string,
  runtime: { assetBucket?: ArticleAssetBucket } = {},
) {
  const existingJob = await getJobRunById(jobId);

  if (!existingJob || !isRecord(existingJob.payload)) {
    throw new NonRetryableArticleJobError('Job payload not found.');
  }

  const job = await markJobRunning(jobId) ?? await getJobRunById(jobId);
  if (!job || job.status !== 'running') return;
  if (!isRecord(job.payload)) {
    throw new NonRetryableArticleJobError('Job payload not found.');
  }
  await appendJobLog(jobId, 'Started image generation workflow.');

  logEvent('info', 'workflow.image_retry.start', { jobId, deckId: job.deckId });

  const payload = job.payload;
  const mode = readString(payload.mode, 'missing') as ImageGenerationMode;
  const scope = readString(payload.scope, 'slides');

  try {
    const illustrationStyle = readIllustrationStyle(payload.illustrationStyle);
    await markJobProgress(jobId, 15, 'Preparing image generation.');

    if (scope === 'cover') {
      const coverSummary = await generateCoverForDeck({
        deckId: job.deckId,
        workspaceId: job.workspaceId,
        illustrationStyle,
        assetBucket: runtime.assetBucket,
      });
      if (coverSummary.status !== 'generated') {
        await failJobRun(
          jobId,
          coverSummary.status === 'failed' ? coverSummary.errorType : 'STALE_REVISION',
          coverSummary.error,
          'failed',
          { coverSummary },
        );
        return;
      }
      await completeJobRun(jobId, { coverSummary });
      logEvent('info', 'workflow.cover_retry.complete', {
        jobId,
        deckId: job.deckId,
        coverStatus: coverSummary.status,
      });
      return;
    }

    const imageSummary = await generateImagesForDeck({
      jobId,
      deckId: job.deckId,
      workspaceId: job.workspaceId,
      illustrationStyle,
      mode,
      assetBucket: runtime.assetBucket,
    });

    if (imageSummary.status === 'failed') {
      await failJobRun(
        jobId,
        imageSummary.errorSummary?.type || 'IMAGE_GENERATION_FAILED',
        imageSummary.errorSummary?.message || 'Image generation failed.',
        'failed',
        imageSummary
      );
      return;
    }

    await completeJobRun(jobId, imageSummary);

    logEvent('info', 'workflow.image_retry.complete', {
      jobId,
      deckId: job.deckId,
      imageStatus: imageSummary.status,
      generated: imageSummary.generated,
      failed: imageSummary.failed,
    });
  } catch (error) {
    if (error instanceof NonRetryableArticleJobError) {
      logEvent('error', 'workflow.image_retry.failed', {
        jobId,
        deckId: job.deckId,
        code: 'INVALID_JOB_PAYLOAD',
        message: error.message,
      });
      await failJobRun(jobId, 'INVALID_JOB_PAYLOAD', error.message);
      return;
    }

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
