import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  generateText,
  resolveTextProviderConfig,
  type TextProvider,
} from './text-provider';

describe('text provider boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_TEXT_MODEL;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_TEXT_MODEL;
  });

  it('resolves the operator DeepSeek deployment configuration', () => {
    const provider = 'deepseek';
    const keyName = 'DEEPSEEK_API_KEY';
    const modelName = 'DEEPSEEK_TEXT_MODEL';
    const defaultModel = 'deepseek-chat';
    process.env[keyName] = 'provider-key';
    const config = resolveTextProviderConfig(provider as TextProvider);
    expect(config).toEqual({ provider, apiKey: 'provider-key', model: defaultModel });
    expect(modelName).toBeTruthy();
  });

  it('requires an explicit Gemini credential instead of reading a platform secret', () => {
    process.env.GEMINI_API_KEY = 'platform-secret-that-must-not-be-read';
    expect(() => resolveTextProviderConfig('gemini')).toThrow(/resolved explicitly/i);
    expect(resolveTextProviderConfig('gemini', {}, 'workspace-key')).toEqual({
      provider: 'gemini',
      apiKey: 'workspace-key',
      model: 'gemini-2.5-flash',
    });
  });

  it('rejects a provider without its deployment key', () => {
    expect(() => resolveTextProviderConfig('deepseek')).toThrow(/DEEPSEEK_API_KEY/i);
  });

  it('sends DeepSeek chat requests without putting the key in the URL or errors', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.deepseek.com/chat/completions');
      expect(String(input)).not.toContain('private-key');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer private-key');
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'A safe reply' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateText({
      provider: 'deepseek',
      apiKey: 'private-key',
      model: 'deepseek-chat',
      systemPrompt: 'You are concise.',
      messages: [{ role: 'user', content: 'Hello' }],
      maxOutputTokens: 128,
      timeoutMs: 1_000,
    })).resolves.toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-chat',
      text: 'A safe reply',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('normalizes malformed provider responses and never exposes credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'quota failed for private-key' } }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    )));

    const caught = await generateText({
      provider: 'deepseek',
      apiKey: 'private-key',
      model: 'deepseek-chat',
      systemPrompt: 'You are concise.',
      messages: [{ role: 'user', content: 'Hello' }],
      maxOutputTokens: 128,
      timeoutMs: 1_000,
    }).then(() => null, (value: unknown) => value as Error);

    expect(caught).toBeInstanceOf(Error);
    const error = caught as Error;
    expect(error.message).not.toContain('private-key');
    expect(error.message).toMatch(/provider|quota|request/i);
  });

  it('preserves a sanitized Gemini quota status for lifecycle handling', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'quota failed for private-key',
      },
    }), { status: 429, headers: { 'content-type': 'application/json' } })));

    const caught = await generateText({
      provider: 'gemini',
      apiKey: 'private-key',
      model: 'gemini-2.5-flash',
      systemPrompt: 'You are concise.',
      messages: [{ role: 'user', content: 'Hello' }],
      maxOutputTokens: 128,
      timeoutMs: 1_000,
    }).then(() => null, (value: unknown) => value as Error & {
      statusCode?: number;
      retryable?: boolean;
    });

    expect(caught).toMatchObject({
      statusCode: 429,
      retryable: true,
      message: expect.stringMatching(/quota/i),
    });
    expect(caught?.message).not.toContain('private-key');
  });

  it('stops reading a chunked DeepSeek response once the byte limit is exceeded', async () => {
    const oversizedChunk = new Uint8Array((2 * 1024 * 1024) + 1);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(oversizedChunk);
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await expect(generateText({
      provider: 'deepseek',
      apiKey: 'private-key',
      model: 'deepseek-chat',
      systemPrompt: 'You are concise.',
      messages: [{ role: 'user', content: 'Hello' }],
      maxOutputTokens: 128,
      timeoutMs: 1_000,
    })).rejects.toMatchObject({
      provider: 'deepseek',
      retryable: false,
      message: expect.stringMatching(/too large/i),
    });
  });
});
