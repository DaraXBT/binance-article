import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GeminiRestError,
  generateGeminiContent,
} from '@/server/integrations/gemini-rest';

const SUCCESS_RESPONSE = {
  candidates: [
    {
      content: {
        parts: [{ text: 'Generated content' }],
      },
    },
  ],
};

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init.headers,
    },
  });
}

describe('Gemini REST provider boundary', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses the official endpoint and keeps the API key in a header', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(SUCCESS_RESPONSE));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateGeminiContent({
      apiKey: 'private-api-key',
      model: 'gemini 2.5/flash',
      prompt: 'Write a short article.',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    })).resolves.toEqual(SUCCESS_RESPONSE);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini%202.5%2Fflash:generateContent'
    );
    expect(String(url)).not.toContain('private-api-key');
    expect(request?.method).toBe('POST');

    const headers = new Headers(request?.headers);
    expect(headers.get('x-goog-api-key')).toBe('private-api-key');
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(request?.body))).toEqual({
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Write a short article.' }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });
  });

  it('rejects a response whose declared size exceeds the configured limit', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': '4097',
      },
    })));

    await expect(generateGeminiContent({
      apiKey: 'test-key',
      model: 'gemini-test',
      prompt: 'hello',
      maxResponseBytes: 4096,
    })).rejects.toMatchObject({
      code: 'GEMINI_RESPONSE_TOO_LARGE',
      statusCode: 502,
    });
  });

  it('stops reading a streamed response after the configured byte limit', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3_000));
        controller.enqueue(new Uint8Array(3_000));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(generateGeminiContent({
      apiKey: 'test-key',
      model: 'gemini-test',
      prompt: 'hello',
      maxResponseBytes: 4096,
    })).rejects.toMatchObject({
      code: 'GEMINI_RESPONSE_TOO_LARGE',
      statusCode: 502,
    });
  });

  it.each([
    ['text/html', '<html>upstream error</html>', 'GEMINI_INVALID_RESPONSE'],
    ['application/json', '{not valid json', 'GEMINI_INVALID_RESPONSE'],
    ['application/json', JSON.stringify({ usageMetadata: {} }), 'GEMINI_INVALID_RESPONSE'],
  ])('rejects invalid provider content (%s)', async (contentType, body, code) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'content-type': contentType },
    })));

    await expect(generateGeminiContent({
      apiKey: 'test-key',
      model: 'gemini-test',
      prompt: 'hello',
    })).rejects.toMatchObject({ code, statusCode: 502 });
  });

  it('times out a provider request with a sanitized error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation((_url, request) => (
      new Promise<Response>((_resolve, reject) => {
        request?.signal?.addEventListener('abort', () => {
          reject(new DOMException('private-api-key timed out', 'AbortError'));
        }, { once: true });
      })
    )));

    const pending = generateGeminiContent({
      apiKey: 'private-api-key',
      model: 'gemini-test',
      prompt: 'hello',
      timeoutMs: 25,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'GEMINI_TIMEOUT',
      statusCode: 504,
      message: 'Gemini request timed out.',
    });

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it('allowlists provider error metadata without retaining raw messages or credentials', async () => {
    const apiKey = 'private-api-key';
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: `Quota failed for ${apiKey}`,
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.RetryInfo',
            retryDelay: '12s',
            internalDebug: apiKey,
          },
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [
              {
                quotaDimensions: {
                  model: 'gemini-test',
                  project: apiKey,
                },
                description: apiKey,
              },
            ],
          },
        ],
      },
    }, { status: 429 })));

    let caught: unknown;
    try {
      await generateGeminiContent({
        apiKey,
        model: 'gemini-test',
        prompt: 'hello',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GeminiRestError);
    expect(caught).toMatchObject({
      code: 'GEMINI_PROVIDER_ERROR',
      statusCode: 429,
      providerCode: 429,
      providerStatus: 'RESOURCE_EXHAUSTED',
      providerDetails: [
        {
          '@type': 'type.googleapis.com/google.rpc.RetryInfo',
          retryDelay: '12s',
        },
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaDimensions: { model: 'gemini-test' } }],
        },
      ],
    });
    expect((caught as Error).message).toBe('Gemini provider request failed.');
    expect(JSON.stringify(caught)).not.toContain(apiKey);
  });

  it('does not expose a credential echoed by a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(
      new Error('socket failed while sending private-api-key')
    ));

    await expect(generateGeminiContent({
      apiKey: 'private-api-key',
      model: 'gemini-test',
      prompt: 'hello',
    })).rejects.toMatchObject({
      code: 'GEMINI_NETWORK_ERROR',
      statusCode: 502,
      message: 'Gemini request failed.',
    });
  });
});
