import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  deckProject: {
    findFirst: vi.fn(),
  },
  slide: {
    update: vi.fn(),
  },
};

type NormalizedImageError = {
  statusCode: number;
  message: string;
  providerCode?: number;
  providerStatus?: string;
  retryAfterSeconds?: number;
  model?: string;
};

const imageGenMock = {
  assertImagePipelineReady: vi.fn(),
  buildImagePrompt: vi.fn((style: string, prompt: string) => `${style}\n${prompt}`),
  generateImage: vi.fn(),
  getStyleDescription: vi.fn(() => 'style-description'),
  normalizeImageGenerationError: vi.fn((error: unknown): NormalizedImageError => ({
    statusCode: 500,
    message: error instanceof Error ? error.message : 'normalized image error',
  })),
  uploadToBlob: vi.fn(),
};

const MISSING_BLOB_TOKEN_MESSAGE =
  'BLOB_READ_WRITE_TOKEN is not set. Add it to .env.local or .env.vercel.local for local development.';

vi.mock('@/lib/prisma', () => ({
  default: prismaMock,
}));

vi.mock('@/lib/image-gen', () => imageGenMock);
vi.mock('@/lib/workspace', () => ({
  getCurrentWorkspace: vi.fn(async () => ({
    workspace: {
      id: 'workspace-1',
      accessKeyPrefix: 'dwk_test',
    },
  })),
}));

function createSlide(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'slide-1',
    order: 0,
    imageUrl: null,
    imagePrompt: 'prompt',
    imageStatus: 'pending',
    imageError: null,
    ...overrides,
  };
}

function mockMissingBlobTokenPreflight(message: string = MISSING_BLOB_TOKEN_MESSAGE) {
  imageGenMock.assertImagePipelineReady.mockImplementation(() => {
    throw new Error(message);
  });
  imageGenMock.normalizeImageGenerationError.mockReturnValueOnce({
    statusCode: 500,
    message,
    providerStatus: 'FAILED_PRECONDITION',
    model: 'gemini-2.5-flash-image',
  });
}

describe('POST /api/articles/[id]/generate-images', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.slide.update.mockResolvedValue({});
    imageGenMock.assertImagePipelineReady.mockReturnValue({
      apiKey: 'key',
      blobToken: 'blob',
      model: 'gemini-2.5-flash-image',
    });
  });

  it('returns success when all slides generate images', async () => {
    prismaMock.deckProject.findFirst.mockResolvedValue({
      id: 'deck-1',
      slides: [
        createSlide({ id: 'slide-1', order: 0 }),
        createSlide({ id: 'slide-2', order: 1 }),
      ],
    });
    imageGenMock.generateImage
      .mockResolvedValueOnce({ buffer: Buffer.from('img-1'), mimeType: 'image/png' })
      .mockResolvedValueOnce({ buffer: Buffer.from('img-2'), mimeType: 'image/png' });
    imageGenMock.uploadToBlob
      .mockResolvedValueOnce('https://demo.public.blob.vercel-storage.com/slide-01.png')
      .mockResolvedValueOnce('https://demo.public.blob.vercel-storage.com/slide-02.png');

    const { POST } = await import('@/app/api/articles/[id]/generate-images/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/generate-images', {
        method: 'POST',
        body: JSON.stringify({ illustrationStyle: 'pixel-art' }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );
    const body = await response.json();

    expect(body.status).toBe('success');
    expect(body.generated).toBe(2);
    expect(body.failed).toBe(0);
    expect(body.results).toHaveLength(2);
  });

  it('returns partial when some slide image generations fail', async () => {
    prismaMock.deckProject.findFirst.mockResolvedValue({
      id: 'deck-1',
      slides: [
        createSlide({ id: 'slide-1', order: 0 }),
        createSlide({ id: 'slide-2', order: 1 }),
      ],
    });
    imageGenMock.generateImage
      .mockResolvedValueOnce({ buffer: Buffer.from('img-1'), mimeType: 'image/png' })
      .mockRejectedValueOnce(new Error('safety block'));
    imageGenMock.uploadToBlob.mockResolvedValueOnce(
      'https://demo.public.blob.vercel-storage.com/slide-01.png'
    );

    const { POST } = await import('@/app/api/articles/[id]/generate-images/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/generate-images', {
        method: 'POST',
        body: JSON.stringify({ illustrationStyle: 'pixel-art' }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );
    const body = await response.json();

    expect(body.status).toBe('partial');
    expect(body.generated).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.results[1].error).toMatch(/safety block/i);
  });

  it('persists a private blob fallback as a storage reference and still reports success', async () => {
    prismaMock.deckProject.findFirst.mockResolvedValue({
      id: 'deck-1',
      slides: [createSlide({ id: 'slide-1', order: 0 })],
    });
    imageGenMock.generateImage.mockResolvedValueOnce({
      buffer: Buffer.from('img-1'),
      mimeType: 'image/png',
    });
    imageGenMock.uploadToBlob.mockResolvedValueOnce(
      'https://demo.private.blob.vercel-storage.com/decks/deck-1/slide-01.png'
    );

    const { POST } = await import('@/app/api/articles/[id]/generate-images/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/generate-images', {
        method: 'POST',
        body: JSON.stringify({ illustrationStyle: 'pixel-art' }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );
    const body = await response.json();

    expect(body.status).toBe('success');
    expect(body.generated).toBe(1);
    expect(body.results[0]).toEqual(
      expect.objectContaining({
        status: 'generated',
        imageUrl: 'https://demo.private.blob.vercel-storage.com/decks/deck-1/slide-01.png',
      })
    );
    expect(prismaMock.slide.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'slide-1' },
        data: expect.objectContaining({
          imageUrl: 'https://demo.private.blob.vercel-storage.com/decks/deck-1/slide-01.png',
          imageStatus: 'generated',
        }),
      })
    );
  });

  it('returns structured quota metadata for failed slides and top-level summary', async () => {
    prismaMock.deckProject.findFirst.mockResolvedValue({
      id: 'deck-1',
      slides: [createSlide({ id: 'slide-1', order: 0 })],
    });
    imageGenMock.generateImage.mockRejectedValueOnce(
      new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}')
    );
    imageGenMock.normalizeImageGenerationError.mockReturnValueOnce({
      statusCode: 429,
      providerCode: 429,
      providerStatus: 'RESOURCE_EXHAUSTED',
      retryAfterSeconds: 22,
      model: 'gemini-2.5-flash-preview-image',
      message:
        'Gemini image quota exceeded for gemini-2.5-flash-preview-image. Retry failed images from the article page in about 22 seconds. Check Gemini quota, billing, or configuration if the issue persists.',
    });

    const { POST } = await import('@/app/api/articles/[id]/generate-images/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/generate-images', {
        method: 'POST',
        body: JSON.stringify({ illustrationStyle: 'pixel-art' }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );
    const body = await response.json();

    expect(body.status).toBe('failed');
    expect(body.errorSummary).toEqual({
      type: 'quota_exceeded',
      message:
        'Gemini image quota exceeded for gemini-2.5-flash-preview-image. Retry failed images from the article page in about 22 seconds. Check Gemini quota, billing, or configuration if the issue persists.',
      providerCode: 429,
      providerStatus: 'RESOURCE_EXHAUSTED',
      retryAfterSeconds: 22,
      model: 'gemini-2.5-flash-preview-image',
    });
    expect(body.results[0]).toEqual(
      expect.objectContaining({
        error:
          'Gemini image quota exceeded for gemini-2.5-flash-preview-image. Retry failed images from the article page in about 22 seconds. Check Gemini quota, billing, or configuration if the issue persists.',
        providerCode: 429,
        providerStatus: 'RESOURCE_EXHAUSTED',
        retryAfterSeconds: 22,
        model: 'gemini-2.5-flash-preview-image',
        errorType: 'quota_exceeded',
      })
    );
  });

  it('returns failed and only retries previously failed slides in failed mode', async () => {
    prismaMock.deckProject.findFirst.mockResolvedValue({
      id: 'deck-1',
      slides: [
        createSlide({ id: 'slide-1', imageStatus: 'failed' }),
        createSlide({ id: 'slide-2', imageStatus: 'pending' }),
      ],
    });
    mockMissingBlobTokenPreflight('BLOB_READ_WRITE_TOKEN is not set');

    const { POST } = await import('@/app/api/articles/[id]/generate-images/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/generate-images', {
        method: 'POST',
        body: JSON.stringify({ illustrationStyle: 'pixel-art', mode: 'failed' }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );
    const body = await response.json();

    expect(body.status).toBe('failed');
    expect(body.total).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.errorSummary).toEqual({
      type: 'configuration',
      message: 'BLOB_READ_WRITE_TOKEN is not set',
      providerCode: undefined,
      providerStatus: 'FAILED_PRECONDITION',
      retryAfterSeconds: undefined,
      model: 'gemini-2.5-flash-image',
    });
    expect(body.results).toEqual([
      expect.objectContaining({
        slideId: 'slide-1',
        status: 'failed',
        error: 'BLOB_READ_WRITE_TOKEN is not set',
        errorType: 'configuration',
        providerStatus: 'FAILED_PRECONDITION',
        model: 'gemini-2.5-flash-image',
      }),
    ]);
    expect(imageGenMock.generateImage).not.toHaveBeenCalled();
    expect(imageGenMock.uploadToBlob).not.toHaveBeenCalled();
  });

  it('keeps missing-token preflight failures structured and stops before upload', async () => {
    prismaMock.deckProject.findFirst.mockResolvedValue({
      id: 'deck-1',
      slides: [createSlide({ id: 'slide-1', order: 0 })],
    });
    mockMissingBlobTokenPreflight();

    const { POST } = await import('@/app/api/articles/[id]/generate-images/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/generate-images', {
        method: 'POST',
        body: JSON.stringify({ illustrationStyle: 'pixel-art' }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );
    const body = await response.json();

    expect(body.status).toBe('failed');
    expect(body.errorSummary).toEqual({
      type: 'configuration',
      message:
        MISSING_BLOB_TOKEN_MESSAGE,
      providerCode: undefined,
      providerStatus: 'FAILED_PRECONDITION',
      retryAfterSeconds: undefined,
      model: 'gemini-2.5-flash-image',
    });
    expect(body.results).toEqual([
      expect.objectContaining({
        slideId: 'slide-1',
        status: 'failed',
        error:
          MISSING_BLOB_TOKEN_MESSAGE,
        errorType: 'configuration',
        providerStatus: 'FAILED_PRECONDITION',
        model: 'gemini-2.5-flash-image',
      }),
    ]);
    expect(JSON.stringify(body)).not.toMatch(/Vercel Blob: No token found/i);
    expect(imageGenMock.generateImage).not.toHaveBeenCalled();
    expect(imageGenMock.uploadToBlob).not.toHaveBeenCalled();
  });

  it('returns 404 when the deck is outside the current workspace', async () => {
    prismaMock.deckProject.findFirst.mockResolvedValue(null);

    const { POST } = await import('@/app/api/articles/[id]/generate-images/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-2/generate-images', {
        method: 'POST',
        body: JSON.stringify({ illustrationStyle: 'pixel-art' }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-2' }) }
    );

    expect(response.status).toBe(404);
    expect(imageGenMock.generateImage).not.toHaveBeenCalled();
  });
});
