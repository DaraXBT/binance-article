import { beforeEach, describe, expect, it } from 'vitest';

describe('image generation provider boundary', () => {
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_IMAGE_MODEL;
  });

  it('extracts inline image data from a Gemini response', async () => {
    const { parseImageGenerationResponse } = await import('@/lib/image-gen');
    const result = parseImageGenerationResponse({
      candidates: [{ content: { parts: [{
        inlineData: { data: Buffer.from('png-bytes').toString('base64'), mimeType: 'image/png' },
      }] } }],
    });
    expect(result.mimeType).toBe('image/png');
    expect(result.buffer.toString()).toBe('png-bytes');
  });

  it('throws when the model returns text instead of an image', async () => {
    const { parseImageGenerationResponse } = await import('@/lib/image-gen');
    expect(() => parseImageGenerationResponse({
      candidates: [{ content: { parts: [{ text: 'I cannot generate that image.' }] } }],
    })).toThrow(/text instead of an image/i);
  });

  it('throws a blocked-response error when no candidates are returned', async () => {
    const { parseImageGenerationResponse } = await import('@/lib/image-gen');
    expect(() => parseImageGenerationResponse({
      candidates: [], promptFeedback: { blockReasonMessage: 'safety block' },
    })).toThrow(/blocked/i);
  });

  it('requires only provider credentials and model configuration at preflight', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_IMAGE_MODEL = 'custom-image-model';
    const { assertImagePipelineReady } = await import('@/lib/image-gen');
    expect(assertImagePipelineReady()).toEqual({
      apiKey: 'test-key', model: 'custom-image-model',
    });
  });

  it('normalizes quota responses without exposing raw provider payloads', async () => {
    process.env.GEMINI_IMAGE_MODEL = 'gemini-image';
    const { normalizeImageGenerationError } = await import('@/lib/image-gen');
    const normalized = normalizeImageGenerationError(new Error(JSON.stringify({ error: {
      code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded',
      details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '22s' }],
    } })));
    expect(normalized).toMatchObject({ statusCode: 429, retryAfterSeconds: 22 });
    expect(normalized.message).toMatch(/retry failed images/i);
    expect(normalized.message).not.toContain('Quota exceeded');
  });
});
