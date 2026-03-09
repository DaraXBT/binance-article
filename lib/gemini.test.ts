import { beforeEach, describe, expect, it } from 'vitest';

describe('gemini helpers', () => {
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_TEXT_MODEL;
    delete process.env.GEMINI_MODEL;
  });

  it('defaults text generation to gemini-2.5-flash', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    const { resolveGeminiTextConfig } = await import('@/lib/gemini');

    expect(resolveGeminiTextConfig()).toEqual({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
    });
  });

  it('allows overriding the text model with GEMINI_TEXT_MODEL', async () => {
    process.env.GOOGLE_API_KEY = 'google-test-key';
    process.env.GEMINI_TEXT_MODEL = 'custom-text-model';

    const { resolveGeminiTextConfig } = await import('@/lib/gemini');

    expect(resolveGeminiTextConfig()).toEqual({
      apiKey: 'google-test-key',
      model: 'custom-text-model',
    });
  });

  it('normalizes Gemini quota errors into a friendly 429 message', async () => {
    const { normalizeGeminiError } = await import('@/lib/gemini');

    const normalized = normalizeGeminiError(
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
                      model: 'gemini-2.0-flash',
                    },
                  },
                ],
              },
              {
                '@type': 'type.googleapis.com/google.rpc.RetryInfo',
                retryDelay: '41s',
              },
            ],
          },
        })
      )
    );

    expect(normalized.statusCode).toBe(429);
    expect(normalized.retryAfterSeconds).toBe(41);
    expect(normalized.model).toBe('gemini-2.0-flash');
    expect(normalized.message).toMatch(/quota exceeded/i);
    expect(normalized.message).toMatch(/41 seconds/i);
  });
});
