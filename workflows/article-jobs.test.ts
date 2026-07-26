import { beforeEach, describe, expect, it, vi } from 'vitest';

const jobs = vi.hoisted(() => ({
  get: vi.fn(),
  markRunning: vi.fn(),
  appendLog: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  progress: vi.fn(),
}));

const generation = vi.hoisted(() => ({
  generateDeck: vi.fn(),
  assertImageReady: vi.fn(),
  listSlides: vi.fn(),
  markDeckStatus: vi.fn(),
  markSlideFailed: vi.fn(),
  markSlideGenerated: vi.fn(),
  markSlidesPending: vi.fn(),
  replaceGeneratedContent: vi.fn(),
  initializeCover: vi.fn(),
  generateImage: vi.fn(),
  resolveWorkspaceGeminiCredential: vi.fn(),
  buildImagePrompt: vi.fn(),
  storeAsset: vi.fn(),
  markCoverGenerated: vi.fn(),
  markCoverFailed: vi.fn(),
}));

vi.mock('@/server/modules/jobs/service', () => ({
  getJobRunById: jobs.get,
  markJobRunning: jobs.markRunning,
  appendJobLog: jobs.appendLog,
  completeJobRun: jobs.complete,
  failJobRun: jobs.fail,
  markJobProgress: jobs.progress,
}));

vi.mock('@/lib/gemini', () => ({
  generateDeckWithProvider: generation.generateDeck,
  resolveGeminiTextConfig: (apiKey: string) => ({ apiKey, model: 'gemini-text' }),
  normalizeGeminiError: (error: unknown) => ({
    message: error instanceof Error ? error.message : 'Generation failed.',
    statusCode: 500,
  }),
}));

vi.mock('@/lib/image-gen', () => ({
  assertImagePipelineReady: generation.assertImageReady,
  buildImagePrompt: generation.buildImagePrompt,
  generateImage: generation.generateImage,
  resolveImagePipelineConfig: (apiKey: string) => ({ apiKey, model: 'gemini-image' }),
  normalizeImageGenerationError: (error: unknown) => ({
    message: error instanceof Error ? error.message : 'Image generation failed.',
  }),
}));

vi.mock('@/server/integrations/workspace-gemini-credential', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/workspace-gemini-credential')>()),
  resolveWorkspaceGeminiCredential: generation.resolveWorkspaceGeminiCredential,
}));

vi.mock('@/lib/db', () => ({
  listSlidesForImageGeneration: generation.listSlides,
  markDeckStatus: generation.markDeckStatus,
  markSlideImageFailed: generation.markSlideFailed,
  markSlideImageGenerated: generation.markSlideGenerated,
  markSlidesImagePending: generation.markSlidesPending,
  replaceGeneratedContent: generation.replaceGeneratedContent,
}));

vi.mock('@/lib/article-cover', () => ({
  buildArticleCoverPrompt: () => ({
    styleMode: 'scene',
    prompt: 'Cover prompt',
  }),
}));

vi.mock('@/server/modules/covers/repository', () => ({
  createArticleCoverRepository: () => ({}),
}));

vi.mock('@/server/modules/assets/repository', () => ({
  createArticleAssetRepository: () => ({}),
}));

vi.mock('@/server/modules/assets/service', () => ({
  storeArticleAsset: generation.storeAsset,
}));

vi.mock('@/server/cloudflare/article-assets', () => ({
  getArticleAssetsBucket: () => ({}),
}));

vi.mock('@/server/db/runtime', () => ({
  getRuntimeDatabase: () => ({}),
}));

vi.mock('@/server/modules/covers/service', () => ({
  initializeArticleCover: generation.initializeCover,
  markArticleCoverFailed: generation.markCoverFailed,
  markArticleCoverGenerated: generation.markCoverGenerated,
}));

import {
  handleArticleGenerationJob,
  handleArticleImageRetryJob,
} from './article-jobs';
import { WorkspaceGeminiCredentialError } from '@/server/integrations/workspace-gemini-credential';

function cancelledJob() {
  const now = new Date('2026-07-22T00:00:00Z');
  return {
    id: 'job_1',
    deckId: 'article_1',
    workspaceId: 'workspace_1',
    kind: 'generate' as const,
    status: 'cancelled' as const,
    progress: 0,
    logs: [],
    errorCode: 'CANCELLED_BY_USER',
    errorMessage: 'Cancelled by user.',
    articleRevisionId: 'article_1:rev:1',
    runId: 'job_1',
    payload: {},
    result: null,
    startedAt: null,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function runningGenerationJob() {
  const now = new Date('2026-07-22T00:00:00Z');
  return {
    ...cancelledJob(),
    status: 'running' as const,
    errorCode: null,
    errorMessage: null,
    completedAt: null,
    startedAt: now,
    payload: {
      mode: 'text',
      articleContent: 'An article long enough to generate.',
      illustrationStyle: 'binance-master',
      slideCount: 1,
      textProvider: 'gemini',
    },
  };
}

function runningImageJob(scope: 'slides' | 'cover' = 'slides') {
  return {
    ...runningGenerationJob(),
    kind: 'generate_images' as const,
    payload: {
      illustrationStyle: 'binance-master',
      mode: 'failed',
      scope,
    },
  };
}

describe('article Workflow cancellation guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobs.get.mockResolvedValue(cancelledJob());
    jobs.markRunning.mockResolvedValue(null);
  });

  it('does not generate an article after its JobRun was cancelled', async () => {
    await expect(handleArticleGenerationJob('job_1')).resolves.toBeUndefined();

    expect(jobs.markRunning).toHaveBeenCalledWith('job_1');
    expect(jobs.get).toHaveBeenCalledTimes(2);
    expect(jobs.appendLog).not.toHaveBeenCalled();
    expect(jobs.progress).not.toHaveBeenCalled();
  });

  it('does not retry article images after their JobRun was cancelled', async () => {
    await expect(handleArticleImageRetryJob('job_1')).resolves.toBeUndefined();

    expect(jobs.markRunning).toHaveBeenCalledWith('job_1');
    expect(jobs.get).toHaveBeenCalledTimes(2);
    expect(jobs.appendLog).not.toHaveBeenCalled();
    expect(jobs.progress).not.toHaveBeenCalled();
  });
});

describe('article image generation progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const job = runningGenerationJob();
    jobs.get.mockResolvedValue(job);
    jobs.markRunning.mockResolvedValue(job);
    generation.generateDeck.mockResolvedValue({
      slides: [{ title: 'Slide 1', bullets: [] }],
    });
    generation.replaceGeneratedContent.mockResolvedValue({ applied: true });
    generation.listSlides.mockResolvedValue({
      title: 'Article title',
      description: 'Article description',
      content: 'Article content',
      generationRevision: 1,
      slides: [
        {
          id: 'slide_1',
          title: 'Slide 1',
          subtitle: null,
          bullets: [],
          order: 0,
          imageUrl: null,
          imageStatus: 'pending',
          imagePrompt: 'A useful diagram',
        },
      ],
    });
    generation.assertImageReady.mockImplementation(() => {
      throw new Error('Image pipeline is not configured');
    });
    generation.initializeCover.mockResolvedValue(false);
    generation.resolveWorkspaceGeminiCredential.mockResolvedValue({
      provider: 'gemini',
      source: 'workspace',
      apiKey: 'workspace-secret-key-with-enough-length',
    });
  });

  it('emits a zero-count image progress log before processing slide images', async () => {
    await handleArticleGenerationJob('job_1');

    expect(generation.resolveWorkspaceGeminiCredential).toHaveBeenCalledOnce();
    expect(generation.generateDeck).toHaveBeenCalledWith(
      expect.objectContaining({ slideCount: 1 }),
      {
        provider: 'gemini',
        apiKey: 'workspace-secret-key-with-enough-length',
        model: 'gemini-text',
      },
    );

    expect(jobs.progress).toHaveBeenCalledWith(
      'job_1',
      55,
      'Generating slide images.',
      { processed: 0, total: 1 },
    );
    expect(generation.markSlidesPending).toHaveBeenCalledWith(
      'workspace_1',
      'article_1',
      ['slide_1'],
    );
  });

  it('keeps processed and total metadata on chunk-completion progress logs', async () => {
    generation.assertImageReady.mockReturnValue(undefined);
    generation.listSlides.mockResolvedValue({
      title: 'Article title',
      description: 'Article description',
      content: 'Article content',
      generationRevision: 1,
      slides: [
        {
          id: 'slide_1',
          title: 'Slide 1',
          subtitle: null,
          bullets: [],
          order: 0,
          imageUrl: null,
          imageStatus: 'pending',
          imagePrompt: null,
        },
      ],
    });

    await handleArticleGenerationJob('job_1');

    expect(jobs.progress).toHaveBeenCalledWith(
      'job_1',
      95,
      'Generated slide images.',
      { processed: 1, total: 1 },
    );
  });
});

describe('article Workflow explicit credential plumbing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generation.resolveWorkspaceGeminiCredential.mockResolvedValue({
      provider: 'gemini',
      source: 'workspace',
      apiKey: 'workspace-secret-key-with-enough-length',
    });
    generation.assertImageReady.mockImplementation((config) => config);
    generation.buildImagePrompt.mockReturnValue('Full slide prompt');
    generation.generateImage.mockResolvedValue({
      buffer: Buffer.from('image-bytes'),
      mimeType: 'image/png',
    });
    generation.storeAsset.mockResolvedValue({
      assetId: 'asset_1',
      reference: '/api/articles/article_1/assets/asset_1.png',
    });
    generation.markCoverGenerated.mockResolvedValue({ status: 'generated' });
    generation.markSlideGenerated.mockResolvedValue({});
    generation.markSlidesPending.mockResolvedValue(1);
  });

  it('resolves once and passes the same explicit key to every slide in a retry', async () => {
    const job = runningImageJob('slides');
    jobs.get.mockResolvedValue(job);
    jobs.markRunning.mockResolvedValue(job);
    generation.listSlides.mockResolvedValue({
      title: 'Article title',
      description: null,
      content: 'Article content',
      generationRevision: 1,
      slides: [
        {
          id: 'slide_1',
          title: 'Slide 1',
          subtitle: null,
          bullets: [],
          order: 0,
          imageUrl: null,
          imageStatus: 'failed',
          imagePrompt: 'Diagram one',
        },
        {
          id: 'slide_2',
          title: 'Slide 2',
          subtitle: null,
          bullets: [],
          order: 1,
          imageUrl: null,
          imageStatus: 'failed',
          imagePrompt: 'Diagram two',
        },
      ],
    });

    await handleArticleImageRetryJob('job_1', { DATABASE_URL: 'postgresql://test' });

    expect(generation.resolveWorkspaceGeminiCredential).toHaveBeenCalledOnce();
    expect(generation.generateImage).toHaveBeenCalledTimes(2);
    expect(generation.generateImage).toHaveBeenNthCalledWith(1, 'Full slide prompt', {
      apiKey: 'workspace-secret-key-with-enough-length',
      model: 'gemini-image',
    });
    expect(generation.generateImage).toHaveBeenNthCalledWith(2, 'Full slide prompt', {
      apiKey: 'workspace-secret-key-with-enough-length',
      model: 'gemini-image',
    });
    expect(JSON.stringify({
      completed: jobs.complete.mock.calls,
      failed: jobs.fail.mock.calls,
      logs: jobs.appendLog.mock.calls,
      progress: jobs.progress.mock.calls,
    })).not.toContain('workspace-secret-key-with-enough-length');
  });

  it('resolves once and passes the explicit key through a cover retry', async () => {
    const job = runningImageJob('cover');
    jobs.get.mockResolvedValue(job);
    jobs.markRunning.mockResolvedValue(job);
    generation.listSlides.mockResolvedValue({
      title: 'Article title',
      description: null,
      content: 'Article content',
      generationRevision: 1,
      slides: [],
    });
    generation.initializeCover.mockResolvedValue({ status: 'pending' });

    await handleArticleImageRetryJob('job_1', { DATABASE_URL: 'postgresql://test' });

    expect(generation.resolveWorkspaceGeminiCredential).toHaveBeenCalledOnce();
    expect(generation.generateImage).toHaveBeenCalledWith(
      'Cover prompt',
      {
        apiKey: 'workspace-secret-key-with-enough-length',
        model: 'gemini-image',
      },
      { aspectRatio: '21:9', imageSize: '2K' },
    );
    expect(JSON.stringify({
      completed: jobs.complete.mock.calls,
      failed: jobs.fail.mock.calls,
      logs: jobs.appendLog.mock.calls,
      progress: jobs.progress.mock.calls,
    })).not.toContain('workspace-secret-key-with-enough-length');
  });

  it('marks pending slide targets failed when an enabled workspace key cannot resolve', async () => {
    const job = runningImageJob('slides');
    jobs.get.mockResolvedValue(job);
    jobs.markRunning.mockResolvedValue(job);
    generation.resolveWorkspaceGeminiCredential.mockRejectedValue(
      new WorkspaceGeminiCredentialError('workspace'),
    );
    generation.listSlides.mockResolvedValue({
      title: 'Article title',
      description: null,
      content: 'Article content',
      generationRevision: 1,
      slides: [{
        id: 'slide_1',
        title: 'Slide 1',
        subtitle: null,
        bullets: [],
        order: 0,
        imageUrl: null,
        imageStatus: 'failed',
        imagePrompt: 'Diagram',
      }],
    });

    await handleArticleImageRetryJob('job_1', { DATABASE_URL: 'postgresql://test' });

    expect(generation.markSlideFailed).toHaveBeenCalledWith(
      'workspace_1',
      'article_1',
      'slide_1',
      expect.stringMatching(/workspace Gemini connection needs attention/i),
    );
    expect(jobs.fail).toHaveBeenCalledWith(
      'job_1',
      'WORKSPACE_GEMINI_CONNECTION_INVALID',
      expect.stringMatching(/workspace Gemini connection needs attention/i),
    );
    expect(generation.generateImage).not.toHaveBeenCalled();
  });

  it('marks a pending cover failed when an enabled workspace key cannot resolve', async () => {
    const job = runningImageJob('cover');
    jobs.get.mockResolvedValue(job);
    jobs.markRunning.mockResolvedValue(job);
    generation.resolveWorkspaceGeminiCredential.mockRejectedValue(
      new WorkspaceGeminiCredentialError('workspace'),
    );
    generation.listSlides.mockResolvedValue({
      title: 'Article title',
      description: null,
      content: 'Article content',
      generationRevision: 3,
      slides: [],
    });

    await handleArticleImageRetryJob('job_1', { DATABASE_URL: 'postgresql://test' });

    expect(generation.markCoverFailed).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      generationRevision: 3,
      error: expect.stringMatching(/workspace Gemini connection needs attention/i),
    }));
    expect(jobs.fail).toHaveBeenCalledWith(
      'job_1',
      'WORKSPACE_GEMINI_CONNECTION_INVALID',
      expect.stringMatching(/workspace Gemini connection needs attention/i),
    );
  });
});
