import { z } from 'zod';

import {
  GeminiRestError,
  generateGeminiContent,
  type GeminiGenerateContentResponse,
} from './gemini-rest';

export const TextProviderSchema = z.enum(['gemini', 'deepseek']);
export type TextProvider = z.infer<typeof TextProviderSchema>;

const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-2.5-flash';
const DEFAULT_DEEPSEEK_TEXT_MODEL = 'deepseek-chat';
const DEEPSEEK_API_ORIGIN = 'https://api.deepseek.com';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const DeepSeekResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().optional() }).passthrough(),
  }).passthrough()).min(1),
}).passthrough();

export type TextProviderMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export interface TextProviderConfig {
  provider: TextProvider;
  apiKey: string;
  model: string;
}

export interface TextGenerationRequest {
  provider: TextProvider;
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: TextProviderMessage[];
  responseFormat?: 'text' | 'json';
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface TextGenerationResult {
  provider: TextProvider;
  model: string;
  text: string;
}

export class TextProviderError extends Error {
  readonly provider: TextProvider;
  readonly statusCode: number;
  readonly retryable: boolean;

  constructor(input: {
    provider: TextProvider;
    message: string;
    statusCode?: number;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = 'TextProviderError';
    this.provider = input.provider;
    this.statusCode = input.statusCode ?? 502;
    this.retryable = input.retryable ?? (this.statusCode >= 500 || this.statusCode === 429);
  }
}

export function resolveTextProviderConfig(
  providerInput: TextProvider,
  environment: Record<string, string | undefined> = process.env,
  explicitApiKey?: string,
): TextProviderConfig {
  const provider = TextProviderSchema.parse(providerInput);
  // Gemini credentials are selected by the workspace resolver and must be
  // supplied explicitly. This deployment resolver only reads the operator
  // DeepSeek key; it never silently falls back to a platform Gemini secret.
  const apiKey = provider === 'gemini'
    ? explicitApiKey
    : environment.DEEPSEEK_API_KEY;
  if (!apiKey?.trim()) {
    throw new TextProviderError({
      provider,
      message: provider === 'gemini'
        ? 'Gemini credentials must be resolved explicitly.'
        : 'DEEPSEEK_API_KEY is not configured.',
      statusCode: 503,
      retryable: false,
    });
  }

  const model = provider === 'gemini'
    ? environment.GEMINI_TEXT_MODEL?.trim() || environment.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_TEXT_MODEL
    : environment.DEEPSEEK_TEXT_MODEL?.trim() || DEFAULT_DEEPSEEK_TEXT_MODEL;
  if (!model) {
    throw new TextProviderError({ provider, message: 'The selected text model is not configured.', statusCode: 503, retryable: false });
  }
  return { provider, apiKey: apiKey.trim(), model };
}

function boundedText(value: string, max = 4_000): string {
  return value.trim().slice(0, max);
}

function geminiPrompt(input: TextGenerationRequest): string {
  const system = boundedText(input.systemPrompt, 12_000);
  const messages = input.messages.map((message) => (
    `${message.role === 'assistant' ? 'ASSISTANT' : 'USER'}:\n${boundedText(message.content, 12_000)}`
  )).join('\n\n');
  return `${system}\n\n${messages}`.trim();
}

function extractGeminiText(response: GeminiGenerateContentResponse): string {
  const text = response.candidates
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text)
    .find((part): part is string => typeof part === 'string' && part.trim().length > 0);
  if (!text) throw new TextProviderError({ provider: 'gemini', message: 'The text provider returned an empty response.' });
  return text.trim();
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new TextProviderError({ provider: 'deepseek', message: 'The text provider response was too large.', statusCode: 502, retryable: false });
  }

  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new TextProviderError({ provider: 'deepseek', message: 'The text provider response was too large.', statusCode: 502, retryable: false });
    }
    body += decoder.decode(value, { stream: true });
  }

  return body + decoder.decode();
}

async function generateWithGemini(input: TextGenerationRequest): Promise<TextGenerationResult> {
  try {
    const result = await generateGeminiContent({
      apiKey: input.apiKey,
      model: input.model,
      prompt: geminiPrompt(input),
      generationConfig: input.responseFormat === 'json'
        ? { responseMimeType: 'application/json', maxOutputTokens: input.maxOutputTokens }
        : { maxOutputTokens: input.maxOutputTokens },
      timeoutMs: input.timeoutMs,
      maxResponseBytes: MAX_RESPONSE_BYTES,
    });
    return { provider: 'gemini', model: input.model, text: extractGeminiText(result) };
  } catch (error) {
    if (error instanceof TextProviderError) throw error;
    if (error instanceof GeminiRestError) {
      throw new TextProviderError({
        provider: 'gemini',
        message: error.statusCode === 429
          ? 'Gemini quota is currently unavailable.'
          : 'Gemini text generation failed.',
        statusCode: error.statusCode,
        retryable: error.statusCode === 429 || error.statusCode >= 500,
      });
    }
    throw new TextProviderError({ provider: 'gemini', message: 'Gemini text generation failed.' });
  }
}

async function generateWithDeepSeek(input: TextGenerationRequest): Promise<TextGenerationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(`${DEEPSEEK_API_ORIGIN}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: 'system', content: boundedText(input.systemPrompt, 12_000) },
          ...input.messages.map((message) => ({ role: message.role, content: boundedText(message.content, 12_000) })),
        ],
        max_tokens: input.maxOutputTokens,
        response_format: input.responseFormat === 'json' ? { type: 'json_object' } : undefined,
      }),
    });
    const body = await readBoundedResponse(response);
    if (!response.ok) {
      throw new TextProviderError({
        provider: 'deepseek',
        message: response.status === 429 ? 'DeepSeek quota is currently unavailable.' : 'DeepSeek request failed.',
        statusCode: response.status,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new TextProviderError({ provider: 'deepseek', message: 'DeepSeek returned an invalid response.', statusCode: 502, retryable: false });
    }
    const result = DeepSeekResponseSchema.safeParse(parsed);
    const text = result.success ? result.data.choices[0]?.message.content?.trim() : undefined;
    if (!text) {
      throw new TextProviderError({ provider: 'deepseek', message: 'DeepSeek returned an empty response.', statusCode: 502, retryable: false });
    }
    return { provider: 'deepseek', model: input.model, text };
  } catch (error) {
    if (error instanceof TextProviderError) throw error;
    throw new TextProviderError({
      provider: 'deepseek',
      message: controller.signal.aborted
        ? 'DeepSeek request timed out.'
        : 'DeepSeek request failed.',
      statusCode: 502,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function generateText(input: TextGenerationRequest): Promise<TextGenerationResult> {
  if (
    typeof input.apiKey !== 'string'
    || !input.apiKey.trim()
    || /[\s\p{Cc}\p{Cf}]/u.test(input.apiKey.trim())
  ) {
    throw new TextProviderError({
      provider: input.provider,
      message: 'The text provider credential is invalid.',
      statusCode: 400,
      retryable: false,
    });
  }
  if (
    typeof input.model !== 'string'
    || !input.model.trim()
    || input.model.trim().length > 160
    || /[\s\p{Cc}\p{Cf}]/u.test(input.model.trim())
  ) {
    throw new TextProviderError({
      provider: input.provider,
      message: 'The text provider model configuration is invalid.',
      statusCode: 400,
      retryable: false,
    });
  }
  if (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > 16_384) {
    throw new TextProviderError({ provider: input.provider, message: 'The text output limit is invalid.', statusCode: 400, retryable: false });
  }
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1_000 || input.timeoutMs > 120_000) {
    throw new TextProviderError({ provider: input.provider, message: 'The text timeout is invalid.', statusCode: 400, retryable: false });
  }
  return input.provider === 'gemini' ? generateWithGemini(input) : generateWithDeepSeek(input);
}
