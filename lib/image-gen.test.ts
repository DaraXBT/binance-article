import { beforeEach, describe, expect, it, vi } from 'vitest';

const putMock = vi.fn();
const MISSING_BLOB_TOKEN_MESSAGE =
  'BLOB_READ_WRITE_TOKEN is not set. Add it to .env.local or .env.vercel.local for local development.';

vi.mock('@vercel/blob', () => ({
  put: putMock,
}));

describe('image-gen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.GEMINI_IMAGE_MODEL;
  });

  it('extracts inline image data from a Gemini response', async () => {
    const { parseImageGenerationResponse } = await import('@/lib/image-gen');

    const result = parseImageGenerationResponse({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: Buffer.from('png-bytes').toString('base64'),
                  mimeType: 'image/png',
                },
              },
            ],
          },
        },
      ],
    });

    expect(result.mimeType).toBe('image/png');
    expect(result.buffer.toString()).toBe('png-bytes');
  });

  it('throws when the model returns text instead of an image', async () => {
    const { parseImageGenerationResponse } = await import('@/lib/image-gen');

    expect(() =>
      parseImageGenerationResponse({
        candidates: [
          {
            content: {
              parts: [{ text: 'I cannot generate that image.' }],
            },
          },
        ],
      })
    ).toThrow(/text instead of an image/i);
  });

  it('throws a blocked-response error when no candidates are returned', async () => {
    const { parseImageGenerationResponse } = await import('@/lib/image-gen');

    expect(() =>
      parseImageGenerationResponse({
        candidates: [],
        promptFeedback: {
          blockReasonMessage: 'safety block',
        },
      })
    ).toThrow(/blocked/i);
  });

  it('fails preflight when the blob token is missing', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    const { assertImagePipelineReady } = await import('@/lib/image-gen');

    expect(() => assertImagePipelineReady()).toThrow(/BLOB_READ_WRITE_TOKEN/i);
  });

  it('returns the resolved pipeline config when env is valid', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.BLOB_READ_WRITE_TOKEN = 'blob-token';
    process.env.GEMINI_IMAGE_MODEL = 'custom-image-model';

    const { assertImagePipelineReady } = await import('@/lib/image-gen');

    expect(assertImagePipelineReady()).toEqual({
      apiKey: 'test-key',
      blobToken: 'blob-token',
      model: 'custom-image-model',
    });
  });

  it('passes the resolved blob token to blob uploads', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'blob-token';
    putMock.mockResolvedValue({
      url: 'https://demo.public.blob.vercel-storage.com/slide-01.png',
    });

    const { uploadToBlob } = await import('@/lib/image-gen');
    const imageBuffer = Buffer.from('img');

    await expect(uploadToBlob(imageBuffer, 'slide-01.png', 'image/png')).resolves.toBe(
      'https://demo.public.blob.vercel-storage.com/slide-01.png'
    );

    expect(putMock).toHaveBeenCalledWith(
      'slide-01.png',
      imageBuffer,
      expect.objectContaining({
        access: 'public',
        contentType: 'image/png',
        allowOverwrite: true,
        token: 'blob-token',
      })
    );
  });

  it('keeps private-store fallback as a server-only blob reference', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'blob-token';
    putMock
      .mockRejectedValueOnce(new Error('Cannot use public access on a private store'))
      .mockResolvedValueOnce({
        url: 'https://demo.private.blob.vercel-storage.com/decks/deck-1/slide-01.png',
      });

    const { uploadToBlob } = await import('@/lib/image-gen');

    await expect(uploadToBlob(Buffer.from('img'), 'decks/deck-1/slide-01.png', 'image/png')).resolves.toBe(
      'https://demo.private.blob.vercel-storage.com/decks/deck-1/slide-01.png'
    );

    expect(putMock).toHaveBeenNthCalledWith(
      2,
      'decks/deck-1/slide-01.png',
      expect.any(Buffer),
      expect.objectContaining({
        access: 'private',
        contentType: 'image/png',
        allowOverwrite: true,
        token: 'blob-token',
      })
    );
  });

  it('fails blob uploads with the existing missing-token configuration message', async () => {
    const { uploadToBlob } = await import('@/lib/image-gen');

    await expect(uploadToBlob(Buffer.from('img'), 'slide-01.png', 'image/png')).rejects.toThrow(
      MISSING_BLOB_TOKEN_MESSAGE
    );
    expect(putMock).not.toHaveBeenCalled();
  });

  it('rejects blob uploads that do not return a public blob URL', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'blob-token';
    putMock.mockResolvedValue({
      url: 'https://example.com/private-image.png',
    });

    const { uploadToBlob } = await import('@/lib/image-gen');

    await expect(
      uploadToBlob(Buffer.from('img'), 'slide-01.png', 'image/png')
    ).rejects.toThrow(/non-public url/i);
    expect(putMock).toHaveBeenCalledWith(
      'slide-01.png',
      expect.any(Buffer),
      expect.objectContaining({ token: 'blob-token' })
    );
  });

  it('normalizes Gemini image quota errors into a friendly message', async () => {
    process.env.GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-preview-image';

    const { normalizeImageGenerationError } = await import('@/lib/image-gen');

    const normalized = normalizeImageGenerationError(
      new Error(
        JSON.stringify({
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            message: 'Quota exceeded',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                violations: [
                  {
                    quotaDimensions: {
                      model: 'gemini-2.5-flash-preview-image',
                    },
                  },
                ],
              },
              {
                '@type': 'type.googleapis.com/google.rpc.RetryInfo',
                retryDelay: '22s',
              },
            ],
          },
        })
      )
    );

    expect(normalized.statusCode).toBe(429);
    expect(normalized.retryAfterSeconds).toBe(22);
    expect(normalized.model).toBe('gemini-2.5-flash-preview-image');
    expect(normalized.message).toMatch(/image quota exceeded/i);
    expect(normalized.message).toMatch(/22 seconds/i);
    expect(normalized.message).toMatch(/retry failed images from the article page/i);
    expect(normalized.message).toMatch(/check gemini quota, billing, or configuration/i);
    expect(normalized.message).not.toMatch(/set GEMINI_IMAGE_MODEL to another available Gemini image model/i);
    expect(normalized.message).not.toMatch(/fallback/i);
  });

  it('normalizes "model not found" errors into a helpful update message', async () => {
    process.env.GEMINI_IMAGE_MODEL = 'gemini-2.0-flash-exp';

    const { normalizeImageGenerationError } = await import('@/lib/image-gen');

    const normalized = normalizeImageGenerationError(
      new Error(
        JSON.stringify({
          error: {
            code: 404,
            status: 'NOT_FOUND',
            message:
              'models/gemini-2.0-flash-exp is not found for API version v1beta, or is not supported for generateContent. Call ListModels to see the list of available models and their supported methods.',
          },
        })
      )
    );

    expect(normalized.statusCode).toBe(404);
    expect(normalized.model).toBe('gemini-2.0-flash-exp');
    expect(normalized.message).toMatch(/not available/i);
    expect(normalized.message).toMatch(/GEMINI_IMAGE_MODEL/i);
  });
});
