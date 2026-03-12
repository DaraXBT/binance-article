import { GoogleGenAI, Modality, type GenerateContentResponse } from '@google/genai';
import { put } from '@vercel/blob';

import { getServerEnv } from '@/lib/server-env';

export const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';

// Style descriptions embedded directly (no filesystem dependency)
const STYLE_DESCRIPTIONS: Record<string, string> = {
  'pixel-art': `Binance Pixel Art Style:
- Dark crypto-native aesthetic with chunky pixel art and isometric scenes
- Canvas Black (#0C0E12) background with Binance Gold (#F0B90B) hero accent
- Pixel grid alignment, dithering, staircase edges, retro sprites
- 8-bit typography, neon glow outlines, floating coin sprites
- GameFi and crypto trading visual language`,

  'fantasy-animation': `Binance Fantasy Animation Style:
- Enchanted storybook narrative with magical glow and painterly warmth
- Dark isometric base with gold-led structure on Canvas Black (#0C0E12)
- Lantern light highlights, expressive animated characters, soft ember accents
- Painterly brush textures, mystical atmosphere, magical particle effects
- Web3 explainer and narrative storytelling visual language`,

  'lab-notes': `Binance Lab Notes Style:
- Technical annotated research diagrams with sparse note clarity
- Dark isometric with one hero mechanism and 2-4 compact labels
- Canvas Black (#0C0E12) background with Binance Gold (#F0B90B) accents
- Figure markers, leader lines, blueprint grid, monospace annotations
- Protocol explainer and technical documentation visual language`,
};

export interface ImagePipelineConfig {
  apiKey: string;
  blobToken: string;
  model: string;
}

export interface ImageGenerationResult {
  buffer: Buffer;
  mimeType: string;
}

export interface ImageGenerationErrorInfo {
  statusCode: number;
  message: string;
  providerCode?: number;
  providerStatus?: string;
  retryAfterSeconds?: number;
  model?: string;
}

interface GeminiErrorPayload {
  code?: number;
  status?: string;
  message?: string;
  details?: Array<Record<string, unknown>>;
}

interface ResponsePart {
  text?: string;
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
}

function getImageApiKey(): string {
  const apiKey = getServerEnv('GEMINI_API_KEY') || getServerEnv('GOOGLE_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY is not set');
  }
  return apiKey;
}

export function getBlobToken(): string {
  const blobToken = getServerEnv('BLOB_READ_WRITE_TOKEN');
  if (!blobToken) {
    throw new Error(
      'BLOB_READ_WRITE_TOKEN is not set. Add it to .env.local or .env.vercel.local for local development.'
    );
  }
  return blobToken;
}

export function getImageModel(): string {
  const configuredModel = getServerEnv('GEMINI_IMAGE_MODEL')?.trim();
  return configuredModel || DEFAULT_IMAGE_MODEL;
}

export function getImageClient(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: getImageApiKey() });
}

export function assertImagePipelineReady(): ImagePipelineConfig {
  const config = {
    apiKey: getImageApiKey(),
    blobToken: getBlobToken(),
    model: getImageModel(),
  };

  void new GoogleGenAI({ apiKey: config.apiKey });

  if (!config.model) {
    throw new Error('GEMINI_IMAGE_MODEL resolved to an empty value');
  }

  return config;
}

function extractGeminiErrorPayload(error: unknown): GeminiErrorPayload | null {
  if (!error) {
    return null;
  }

  if (typeof error === 'object') {
    const candidate = error as Record<string, unknown>;
    if (candidate.error && typeof candidate.error === 'object') {
      return candidate.error as GeminiErrorPayload;
    }
  }

  const rawMessage =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : null;

  if (!rawMessage) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawMessage) as Record<string, unknown>;
    if (parsed.error && typeof parsed.error === 'object') {
      return parsed.error as GeminiErrorPayload;
    }

    return parsed as GeminiErrorPayload;
  } catch {
    return null;
  }
}

function extractRetryAfterSeconds(details: Array<Record<string, unknown>> | undefined) {
  if (!details) {
    return undefined;
  }

  for (const detail of details) {
    if (
      detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' &&
      typeof detail.retryDelay === 'string'
    ) {
      const match = detail.retryDelay.match(/(\d+(?:\.\d+)?)s/);
      if (match) {
        return Math.ceil(Number.parseFloat(match[1]));
      }
    }
  }

  return undefined;
}

function extractQuotaModel(details: Array<Record<string, unknown>> | undefined) {
  if (!details) {
    return undefined;
  }

  for (const detail of details) {
    if (
      detail['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure' &&
      Array.isArray(detail.violations)
    ) {
      for (const violation of detail.violations) {
        if (
          violation &&
          typeof violation === 'object' &&
          'quotaDimensions' in violation &&
          violation.quotaDimensions &&
          typeof violation.quotaDimensions === 'object' &&
          'model' in violation.quotaDimensions &&
          typeof violation.quotaDimensions.model === 'string'
        ) {
          return violation.quotaDimensions.model;
        }
      }
    }
  }

  return undefined;
}

export function normalizeImageGenerationError(
  error: unknown,
  fallbackMessage = 'Failed to generate image'
): ImageGenerationErrorInfo {
  const payload = extractGeminiErrorPayload(error);

  if (!payload) {
    return {
      statusCode: 500,
      message: fallbackMessage,
    };
  }

  const retryAfterSeconds = extractRetryAfterSeconds(payload.details);
  const model = extractQuotaModel(payload.details) || getImageModel();
  const providerCode = payload.code;
  const providerStatus = payload.status;
  const statusCode =
    typeof providerCode === 'number' && providerCode >= 400 && providerCode < 600
      ? providerCode
      : providerStatus === 'RESOURCE_EXHAUSTED'
        ? 429
        : 500;

  if (statusCode === 429 || providerStatus === 'RESOURCE_EXHAUSTED') {
    const retryText = retryAfterSeconds
      ? ` Retry failed images from the article page in about ${retryAfterSeconds} seconds.`
      : ' Retry failed images from the article page later.';
    const modelText = model ? ` for ${model}` : '';

    return {
      statusCode: 429,
      providerCode,
      providerStatus,
      retryAfterSeconds,
      model,
      message:
        `Gemini image quota exceeded${modelText}.${retryText} ` +
        'Check Gemini quota, billing, or configuration if the issue persists.',
    };
  }

  const rawMessage = payload.message || fallbackMessage;

  if (providerStatus === 'NOT_FOUND' || /is not found|not supported for generateContent/i.test(rawMessage)) {
    return {
      statusCode: 404,
      providerCode,
      providerStatus,
      model,
      message:
        `Model "${model}" is not available. ` +
        `Update GEMINI_IMAGE_MODEL in your environment to a supported model (default: ${DEFAULT_IMAGE_MODEL}).`,
    };
  }

  return {
    statusCode,
    providerCode,
    providerStatus,
    retryAfterSeconds,
    model,
    message: rawMessage,
  };
}

function getPromptFeedbackMessage(response: Pick<GenerateContentResponse, 'promptFeedback'>): string | null {
  const feedback = response.promptFeedback as
    | {
        blockReason?: string;
        blockReasonMessage?: string;
      }
    | undefined;

  if (!feedback) {
    return null;
  }

  return feedback.blockReasonMessage || feedback.blockReason || null;
}

export function parseImageGenerationResponse(
  response: Pick<GenerateContentResponse, 'candidates' | 'promptFeedback'>
): ImageGenerationResult {
  const candidates = response.candidates ?? [];

  if (candidates.length === 0) {
    const feedbackMessage = getPromptFeedbackMessage(response);
    throw new Error(
      feedbackMessage
        ? `Image generation was blocked: ${feedbackMessage}`
        : 'Image generation returned no candidates'
    );
  }

  const parts = (candidates[0]?.content?.parts ?? []) as ResponsePart[];

  for (const part of parts) {
    if (part.inlineData?.data) {
      const mimeType = part.inlineData.mimeType || 'image/png';
      return {
        buffer: Buffer.from(part.inlineData.data, 'base64'),
        mimeType,
      };
    }
  }

  const textResponse = parts.find((part) => part.text?.trim())?.text?.trim();
  if (textResponse) {
    throw new Error(`Image generation returned text instead of an image: ${textResponse.slice(0, 160)}`);
  }

  throw new Error('Image generation returned no image data');
}

/**
 * Generate an image using Gemini's image generation capability.
 * Returns the image as a Buffer and its MIME type.
 */
export async function generateImage(prompt: string): Promise<ImageGenerationResult> {
  const client = getImageClient();
  const model = getImageModel();

  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseModalities: [Modality.IMAGE, Modality.TEXT],
      imageConfig: {
        aspectRatio: '16:9',
        imageSize: '1K',
      },
    },
  });

  return parseImageGenerationResponse(response);
}

function assertBrowserSafeBlobUrl(url: string): string {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Blob upload returned an invalid URL: ${url}`);
  }

  const isHttps = parsed.protocol === 'https:';
  const isVercelBlobHost = parsed.hostname.endsWith('blob.vercel-storage.com');

  if (!isHttps || !isVercelBlobHost) {
    throw new Error(`Blob upload returned a non-public URL: ${url}`);
  }

  return url;
}

/**
 * Upload an image buffer to Vercel Blob storage.
 * Returns a stored blob reference.
 * Public uploads return a browser-safe URL.
 * Private-store fallback returns a server-only blob reference that must be
 * proxied through an authorized app route before browser use.
 */
export async function uploadToBlob(
  imageBuffer: Buffer,
  filename: string,
  contentType: string = 'image/png'
): Promise<string> {
  const token = getBlobToken();
  try {
    const { url } = await put(filename, imageBuffer, {
      access: 'public',
      contentType,
      allowOverwrite: true,
      token,
    });
    return assertBrowserSafeBlobUrl(url);
  } catch (err: any) {
    if (err?.message?.includes('Cannot use public access on a private store')) {
      console.warn('[Blob] Public access failed on private store, falling back to private access');
      const { url } = await put(filename, imageBuffer, {
        access: 'private',
        contentType,
        allowOverwrite: true,
        token,
      });
      return url;
    }
    throw err;
  }
}

/**
 * Get embedded style description (no filesystem needed).
 */
export function getStyleDescription(illustrationStyle: string): string {
  return STYLE_DESCRIPTIONS[illustrationStyle] || STYLE_DESCRIPTIONS['pixel-art'];
}

/**
 * Build the full image prompt by combining style description with slide-specific prompt.
 */
export function buildImagePrompt(styleDescription: string, slidePrompt: string): string {
  return `${styleDescription}

---

Generate a single illustration following the style above.
- Output must be a clean 16:9 composition suitable for a presentation slide
- Do not include any overlaid title text, captions, logos, or watermarks
- Focus on one clear visual scene with strong hierarchy

Content:
${slidePrompt}`;
}
