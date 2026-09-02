const GEMINI_API_ORIGIN = 'https://generativelanguage.googleapis.com';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_VALIDATION_TIMEOUT_MS = 10_000;
const DEFAULT_VALIDATION_MAX_RESPONSE_BYTES = 64 * 1024;
const SAFE_PROVIDER_STATUSES = new Set([
  'RESOURCE_EXHAUSTED',
  'INVALID_ARGUMENT',
  'FAILED_PRECONDITION',
  'PERMISSION_DENIED',
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'INTERNAL',
  'UNAVAILABLE',
  'DEADLINE_EXCEEDED',
  'ABORTED',
  'CANCELLED',
  'UNKNOWN',
  'ALREADY_EXISTS',
  'OUT_OF_RANGE',
  'DATA_LOSS',
]);

type GeminiRestErrorCode =
  | 'GEMINI_INVALID_REQUEST'
  | 'GEMINI_INVALID_MODEL_CONFIGURATION'
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

export interface ValidateGeminiApiKeyInput {
  apiKey: string;
  textModel: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface ValidatedGeminiApiKey {
  readonly models: readonly [string];
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

function sanitizeProviderDetails(
  value: unknown,
  expectedModel?: string,
): GeminiProviderDetail[] | undefined {
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
          // Only retain a quota model when it matches the model we requested.
          // Provider-controlled strings are otherwise untrusted and could echo
          // a credential into persisted job metadata.
          if (
            typeof model !== 'string'
            || model.length === 0
            || model.length > 160
            || (expectedModel !== undefined && model !== expectedModel)
          ) return [];
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

function parseProviderError(
  body: string,
  responseStatus: number,
  expectedModel?: string,
): GeminiRestError {
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
  const rawProviderStatus = providerError && typeof providerError.status === 'string'
    ? providerError.status.slice(0, 80)
    : undefined;
  const providerStatus = rawProviderStatus && SAFE_PROVIDER_STATUSES.has(rawProviderStatus)
    ? rawProviderStatus
    : undefined;
  const providerDetails = sanitizeProviderDetails(providerError?.details, expectedModel);

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

function normalizeApiKeyForValidation(value: unknown): string {
  if (typeof value !== 'string') {
    throw new GeminiRestError({
      code: 'GEMINI_INVALID_REQUEST',
      message: 'The Gemini API key is invalid.',
      statusCode: 400,
    });
  }
  const apiKey = value.trim();
  if (
    apiKey.length < 20
    || apiKey.length > 512
    || /[\s\p{Cc}\p{Cf}]/u.test(apiKey)
  ) {
    throw new GeminiRestError({
      code: 'GEMINI_INVALID_REQUEST',
      message: 'The Gemini API key is invalid.',
      statusCode: 400,
    });
  }
  return apiKey;
}

function normalizeModelForValidation(value: unknown): string {
  if (typeof value !== 'string') {
    throw new GeminiRestError({
      code: 'GEMINI_INVALID_MODEL_CONFIGURATION',
      message: 'The Gemini model configuration is invalid.',
      statusCode: 500,
    });
  }
  const model = value.trim();
  if (!model || model.length > 160 || /[\s\p{Cc}\p{Cf}]/u.test(model)) {
    throw new GeminiRestError({
      code: 'GEMINI_INVALID_MODEL_CONFIGURATION',
      message: 'The Gemini model configuration is invalid.',
      statusCode: 500,
    });
  }
  return model;
}

function parseValidationResponse(body: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }

  // A successful generateContent response can legitimately contain only
  // prompt feedback (for example if a provider safety setting blocks the
  // harmless probe). Do not require a particular candidate or response string,
  // but do require a documented generation-result shape so a malformed 200
  // response cannot falsely validate a credential.
  if (
    !isRecord(parsed)
    || (!Array.isArray(parsed.candidates) && !isRecord(parsed.promptFeedback))
  ) {
    throw new GeminiRestError({
      code: 'GEMINI_INVALID_RESPONSE',
      message: 'Gemini returned an invalid validation response.',
      statusCode: 502,
    });
  }
}

async function validateGeminiTextGeneration(input: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxResponseBytes: number;
}): Promise<void> {
  const endpoint = `${GEMINI_API_ORIGIN}/v1beta/models/${encodeURIComponent(input.model)}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': input.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Reply with OK.' }],
          },
        ],
        generationConfig: {
          candidateCount: 1,
          maxOutputTokens: 8,
          temperature: 0,
        },
      }),
      signal: controller.signal,
    });
    const body = await readBoundedBody(response, input.maxResponseBytes);
    if (!response.ok) throw parseProviderError(body, response.status, input.model);

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('application/json')) {
      throw new GeminiRestError({
        code: 'GEMINI_INVALID_RESPONSE',
        message: 'Gemini returned an invalid validation response.',
        statusCode: 502,
      });
    }

    parseValidationResponse(body);
  } catch (error) {
    if (error instanceof GeminiRestError) throw error;
    if (controller.signal.aborted) {
      throw new GeminiRestError({
        code: 'GEMINI_TIMEOUT',
        message: 'Gemini credential validation timed out.',
        statusCode: 504,
      });
    }
    throw new GeminiRestError({
      code: 'GEMINI_NETWORK_ERROR',
      message: 'Gemini credential validation failed.',
      statusCode: 502,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Confirms that a transient key can access the required text-generation model.
 * Image generation is optional, so it validates its configured model only when
 * the user asks to create images. The credential is sent only through Google's
 * API-key header and no provider response body is returned to callers.
 */
export async function validateGeminiApiKey(
  input: ValidateGeminiApiKeyInput,
): Promise<ValidatedGeminiApiKey> {
  const apiKey = normalizeApiKeyForValidation(input.apiKey);
  const textModel = normalizeModelForValidation(input.textModel);
  const timeoutMs = positiveInteger(
    input.timeoutMs,
    DEFAULT_VALIDATION_TIMEOUT_MS,
    'Gemini validation timeout',
  );
  const maxResponseBytes = positiveInteger(
    input.maxResponseBytes,
    DEFAULT_VALIDATION_MAX_RESPONSE_BYTES,
    'Gemini validation response limit',
  );
  await validateGeminiTextGeneration({
    apiKey,
    model: textModel,
    timeoutMs,
    maxResponseBytes,
  });

  return { models: [textModel] };
}

export async function generateGeminiContent(
  input: GenerateGeminiContentInput
): Promise<GeminiGenerateContentResponse> {
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (
    !apiKey
    || apiKey.length > 512
    || /[\s\p{Cc}\p{Cf}]/u.test(apiKey)
    || !model
    || model.length > 160
    || /[\p{Cc}\p{Cf}]/u.test(model)
    || !prompt
  ) {
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

    if (!response.ok) throw parseProviderError(body, response.status, input.model);

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
