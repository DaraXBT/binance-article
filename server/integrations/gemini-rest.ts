const GEMINI_API_ORIGIN = 'https://generativelanguage.googleapis.com';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

type GeminiRestErrorCode =
  | 'GEMINI_INVALID_REQUEST'
  | 'GEMINI_TIMEOUT'
  | 'GEMINI_NETWORK_ERROR'
  | 'GEMINI_RESPONSE_TOO_LARGE'
  | 'GEMINI_INVALID_RESPONSE'
  | 'GEMINI_PROVIDER_ERROR';

type GeminiProviderDetail =
  | {
      '@type': 'type.googleapis.com/google.rpc.RetryInfo';
      retryDelay: string;
    }
  | {
      '@type': 'type.googleapis.com/google.rpc.QuotaFailure';
      violations: Array<{ quotaDimensions: { model: string } }>;
    };

export interface GeminiContentPart {
  text?: string;
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
}

export interface GeminiGenerateContentResponse {
  candidates: Array<{
    content?: {
      parts?: GeminiContentPart[];
    };
  }>;
  promptFeedback?: {
    blockReason?: string;
    blockReasonMessage?: string;
  };
}

interface GenerateGeminiContentInput {
  apiKey: string;
  model: string;
  prompt: string;
  generationConfig?: Record<string, unknown>;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

interface GeminiRestErrorOptions {
  code: GeminiRestErrorCode;
  message: string;
  statusCode: number;
  providerCode?: number;
  providerStatus?: string;
  providerDetails?: GeminiProviderDetail[];
}

export class GeminiRestError extends Error {
  readonly code: GeminiRestErrorCode;
  readonly statusCode: number;
  readonly providerCode?: number;
  readonly providerStatus?: string;
  readonly providerDetails?: GeminiProviderDetail[];

  constructor(options: GeminiRestErrorOptions) {
    super(options.message);
    this.name = 'GeminiRestError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.providerCode = options.providerCode;
    this.providerStatus = options.providerStatus;
    this.providerDetails = options.providerDetails;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new GeminiRestError({
      code: 'GEMINI_INVALID_REQUEST',
      message: `${label} must be a positive integer.`,
      statusCode: 500,
    });
  }
  return resolved;
}

function providerHttpStatus(value: number): number {
  return Number.isInteger(value) && value >= 400 && value <= 599 ? value : 502;
}

function sanitizeProviderDetails(value: unknown): GeminiProviderDetail[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const sanitized: GeminiProviderDetail[] = [];
  for (const item of value.slice(0, 20)) {
    if (!isRecord(item)) continue;

    if (
      item['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' &&
      typeof item.retryDelay === 'string' &&
      /^\d+(?:\.\d+)?s$/.test(item.retryDelay)
    ) {
      sanitized.push({
        '@type': 'type.googleapis.com/google.rpc.RetryInfo',
        retryDelay: item.retryDelay.slice(0, 32),
      });
      continue;
    }

    if (
      item['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure' &&
      Array.isArray(item.violations)
    ) {
      const violations = item.violations
        .slice(0, 20)
        .flatMap((violation) => {
          if (!isRecord(violation) || !isRecord(violation.quotaDimensions)) return [];
          const model = violation.quotaDimensions.model;
          if (typeof model !== 'string' || model.length === 0 || model.length > 160) return [];
          return [{ quotaDimensions: { model } }];
        });

      if (violations.length > 0) {
        sanitized.push({
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations,
        });
      }
    }
  }

  return sanitized.length > 0 ? sanitized : undefined;
}

function parseProviderError(body: string, responseStatus: number): GeminiRestError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }

  const providerError = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : null;
  const providerCode = providerError && typeof providerError.code === 'number'
    ? providerError.code
    : undefined;
  const providerStatus = providerError && typeof providerError.status === 'string'
    ? providerError.status.slice(0, 80)
    : undefined;
  const providerDetails = sanitizeProviderDetails(providerError?.details);

  return new GeminiRestError({
    code: 'GEMINI_PROVIDER_ERROR',
    message: 'Gemini provider request failed.',
    statusCode: providerHttpStatus(responseStatus),
    providerCode,
    providerStatus,
    providerDetails,
  });
}

async function readBoundedBody(response: Response, maxResponseBytes: number): Promise<string> {
  const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    throw new GeminiRestError({
      code: 'GEMINI_RESPONSE_TOO_LARGE',
      message: 'Gemini response exceeded the allowed size.',
      statusCode: 502,
    });
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
    if (totalBytes > maxResponseBytes) {
      await reader.cancel().catch(() => undefined);
      throw new GeminiRestError({
        code: 'GEMINI_RESPONSE_TOO_LARGE',
        message: 'Gemini response exceeded the allowed size.',
        statusCode: 502,
      });
    }
    body += decoder.decode(value, { stream: true });
  }

  return body + decoder.decode();
}

function parseSuccessResponse(body: string): GeminiGenerateContentResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new GeminiRestError({
      code: 'GEMINI_INVALID_RESPONSE',
      message: 'Gemini returned an invalid response.',
      statusCode: 502,
    });
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) {
    throw new GeminiRestError({
      code: 'GEMINI_INVALID_RESPONSE',
      message: 'Gemini returned an invalid response.',
      statusCode: 502,
    });
  }

  return parsed as unknown as GeminiGenerateContentResponse;
}

export async function generateGeminiContent(
  input: GenerateGeminiContentInput
): Promise<GeminiGenerateContentResponse> {
  const apiKey = input.apiKey.trim();
  const model = input.model.trim();
  const prompt = input.prompt.trim();
  if (!apiKey || !model || !prompt) {
    throw new GeminiRestError({
      code: 'GEMINI_INVALID_REQUEST',
      message: 'Gemini credentials, model, and prompt are required.',
      statusCode: 500,
    });
  }

  const timeoutMs = positiveInteger(input.timeoutMs, DEFAULT_TIMEOUT_MS, 'Gemini timeout');
  const maxResponseBytes = positiveInteger(
    input.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    'Gemini response limit'
  );
  const endpoint = `${GEMINI_API_ORIGIN}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        ...(input.generationConfig ? { generationConfig: input.generationConfig } : {}),
      }),
      signal: controller.signal,
    });
    const body = await readBoundedBody(response, maxResponseBytes);

    if (!response.ok) throw parseProviderError(body, response.status);

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('application/json')) {
      throw new GeminiRestError({
        code: 'GEMINI_INVALID_RESPONSE',
        message: 'Gemini returned an invalid response.',
        statusCode: 502,
      });
    }

    return parseSuccessResponse(body);
  } catch (error) {
    if (error instanceof GeminiRestError) throw error;

    if (controller.signal.aborted) {
      throw new GeminiRestError({
        code: 'GEMINI_TIMEOUT',
        message: 'Gemini request timed out.',
        statusCode: 504,
      });
    }

    throw new GeminiRestError({
      code: 'GEMINI_NETWORK_ERROR',
      message: 'Gemini request failed.',
      statusCode: 502,
    });
  } finally {
    clearTimeout(timeout);
  }
}
