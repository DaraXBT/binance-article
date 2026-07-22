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

  it('rejects inline data that is not a supported raster image', async () => {
    const { parseImageGenerationResponse } = await import('@/lib/image-gen');
    expect(() => parseImageGenerationResponse({
      candidates: [{ content: { parts: [{
        inlineData: {
          data: Buffer.from('<svg onload="alert(1)" />').toString('base64'),
          mimeType: 'image/svg+xml',
        },
      }] } }],
    })).toThrow(/unsupported image type/i);
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

  it('resolves every Binance style to distinct image guidance and policy-aware prompts', async () => {
    const { buildImagePrompt, getStyleDescription } = await import('@/lib/image-gen');
    const styles = [
      'binance',
      'binance-master',
      'binance-briefing',
      'binance-mondo-panoramic',
      'binance-sketch-notes',
      'binance-vector-illustration',
    ] as const;

    const descriptions = styles.map((style) => getStyleDescription(style));
    expect(new Set(descriptions).size).toBe(styles.length);
    expect(descriptions.join('\n')).toContain('#0C0E12');

    expect(buildImagePrompt('binance', 'A liquidity platform')).toMatch(/exactly one BNB mark/i);
    expect(buildImagePrompt(getStyleDescription('binance'), 'A liquidity platform'))
      .toMatch(/exactly one BNB mark/i);
    expect(buildImagePrompt('binance-briefing', 'A protocol comparison')).toMatch(/article-language labels/i);
    expect(buildImagePrompt('binance-mondo-panoramic', 'An exchange evolution')).toMatch(/no captions or labels/i);
    expect(buildImagePrompt('binance-sketch-notes', 'Wallet safety')).toMatch(/hand-lettered/i);
    expect(buildImagePrompt('binance-vector-illustration', 'A wallet')).toMatch(/short article-language labels/i);
  });
});
