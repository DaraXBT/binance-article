import { GoogleGenAI } from '@google/genai';

import { getServerEnv } from '@/lib/server-env';
import { DeckGenerateRequest } from './schemas';

const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-2.5-flash';

type GeminiErrorPayload = {
  code?: number;
  status?: string;
  message?: string;
  details?: Array<Record<string, unknown>>;
};

export interface GeneratedCaptionPackage {
  blog: {
    seoTitle?: string;
    metaDescription?: string;
    introText?: string;
    sections?: string[];
    tags?: string[];
  };
  twitter: {
    singles?: string[];
    thread?: string;
  };
}

export interface GeneratedSlideWithPrompt {
  title: string;
  subtitle?: string;
  bulletPoints: string[];
  notes?: string;
  imagePrompt: string;
  order: number;
}

export interface GeneratedDeckResponse {
  slides: GeneratedSlideWithPrompt[];
  captions: GeneratedCaptionPackage;
  metadata: {
    totalSlides: number;
    generatedAt: string;
  };
}

export interface GeminiTextConfig {
  apiKey: string;
  model: string;
}

export interface GeminiErrorInfo {
  statusCode: number;
  message: string;
  providerCode?: number;
  providerStatus?: string;
  retryAfterSeconds?: number;
  model?: string;
}

export function resolveGeminiTextConfig(): GeminiTextConfig {
  const apiKey = getServerEnv('GEMINI_API_KEY') || getServerEnv('GOOGLE_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY environment variable is not set');
  }

  const model =
    getServerEnv('GEMINI_TEXT_MODEL')?.trim() ||
    getServerEnv('GEMINI_MODEL')?.trim() ||
    DEFAULT_GEMINI_TEXT_MODEL;

  if (!model) {
    throw new Error('GEMINI_TEXT_MODEL resolved to an empty value');
  }

  return {
    apiKey,
    model,
  };
}

export function createGeminiTextClient(config = resolveGeminiTextConfig()) {
  return new GoogleGenAI({ apiKey: config.apiKey });
}

export function normalizeGeminiError(
  error: unknown,
  fallbackMessage = 'Failed to generate content'
): GeminiErrorInfo {
  const payload = extractGeminiErrorPayload(error);

  if (!payload) {
    return {
      statusCode: 500,
      message: error instanceof Error ? error.message : fallbackMessage,
    };
  }

  const retryAfterSeconds = extractRetryAfterSeconds(payload.details);
  const model = extractQuotaModel(payload.details);
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
      ? ` Retry in about ${retryAfterSeconds} seconds.`
      : '';
    const modelText = model ? ` for ${model}` : '';

    return {
      statusCode: 429,
      providerCode,
      providerStatus,
      retryAfterSeconds,
      model,
      message:
        `Gemini API quota exceeded${modelText}.${retryText} ` +
        'Check quota and billing for the configured Google project, or set GEMINI_TEXT_MODEL to another available Gemini text model.',
    };
  }

  return {
    statusCode,
    providerCode,
    providerStatus,
    retryAfterSeconds,
    model,
    message: payload.message || (error instanceof Error ? error.message : fallbackMessage),
  };
}

export async function generatePlainTextWithGemini(prompt: string): Promise<string> {
  const config = resolveGeminiTextConfig();
  const client = createGeminiTextClient(config);
  const result = await client.models.generateContent({
    model: config.model,
    contents: prompt,
  });
  const responseText = result.text?.trim();

  if (!responseText) {
    throw new Error('Gemini returned an empty response');
  }

  return responseText;
}

export async function generateDeckWithGemini(
  request: DeckGenerateRequest
): Promise<GeneratedDeckResponse> {
  const prompt = buildGenerationPrompt(request);
  const config = resolveGeminiTextConfig();
  const client = createGeminiTextClient(config);
  const result = await client.models.generateContent({
    model: config.model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
    },
  });
  const responseText = result.text;

  if (!responseText) {
    throw new Error('Gemini returned an empty response');
  }

  const parsed = parseDeckResponseText(responseText);

  if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error('No slides generated');
  }

  const slides: GeneratedSlideWithPrompt[] = parsed.slides.map(
    (slide: Record<string, unknown>, index: number) => ({
      title: typeof slide.title === 'string' ? slide.title : 'Untitled Slide',
      subtitle: typeof slide.subtitle === 'string' ? slide.subtitle : '',
      bulletPoints: Array.isArray(slide.bulletPoints)
        ? slide.bulletPoints.filter((point): point is string => typeof point === 'string')
        : [],
      notes: typeof slide.notes === 'string' ? slide.notes : '',
      imagePrompt:
        typeof slide.imagePrompt === 'string' && slide.imagePrompt.trim().length > 0
          ? slide.imagePrompt
          : `Illustration for: ${typeof slide.title === 'string' ? slide.title : 'Untitled Slide'}`,
      order: index,
    })
  );

  const captionsSource =
    parsed.captions && typeof parsed.captions === 'object'
      ? (parsed.captions as Record<string, unknown>)
      : {};
  const blogSource =
    captionsSource.blog && typeof captionsSource.blog === 'object'
      ? (captionsSource.blog as Record<string, unknown>)
      : {};
  const twitterSource =
    captionsSource.twitter && typeof captionsSource.twitter === 'object'
      ? (captionsSource.twitter as Record<string, unknown>)
      : {};

  const captions: GeneratedCaptionPackage = {
    blog: {
      seoTitle:
        typeof blogSource.seoTitle === 'string'
          ? blogSource.seoTitle
          : slides[0]?.title || 'Article',
      metaDescription:
        typeof blogSource.metaDescription === 'string' ? blogSource.metaDescription : '',
      introText: typeof blogSource.introText === 'string' ? blogSource.introText : '',
      sections: Array.isArray(blogSource.sections)
        ? blogSource.sections.filter((section): section is string => typeof section === 'string')
        : slides.map((slide) => slide.title),
      tags: Array.isArray(blogSource.tags)
        ? blogSource.tags.filter((tag): tag is string => typeof tag === 'string')
        : [],
    },
    twitter: {
      singles: Array.isArray(twitterSource.singles)
        ? twitterSource.singles.filter((tweet): tweet is string => typeof tweet === 'string')
        : [],
      thread: typeof twitterSource.thread === 'string' ? twitterSource.thread : '',
    },
  };

  return {
    slides,
    captions,
    metadata: {
      totalSlides: slides.length,
      generatedAt: new Date().toISOString(),
    },
  };
}

function parseDeckResponseText(responseText: string) {
  const trimmed = responseText.trim();

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse Gemini response as JSON');
    }

    return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  }
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

function buildGenerationPrompt(request: DeckGenerateRequest): string {
  const styleDescriptions: Record<string, string> = {
    'pixel-art':
      'Binance × Retro 8-Bit: dark crypto-native style with chunky pixel art, isometric scenes, gold (#F0B90B) hero accent on Canvas Black (#0C0E12). Pixel grid alignment, dithering, staircase edges, retro sprites.',
    'fantasy-animation':
      'Binance × Enchanted Storybook: dark isometric with gold-led structure, painterly warmth, magical narrative glow. Lantern light highlights, expressive characters, soft ember accents on Canvas Black.',
    'lab-notes':
      'Binance × Lab Notes: dark isometric with sparse technical annotations and research-note clarity. One hero mechanism, 2-4 compact labels, figure markers, leader lines on Canvas Black.',
  };

  const styleGuide =
    styleDescriptions[request.illustrationStyle] || styleDescriptions['pixel-art'];

  const contentInstruction =
    request.mode === 'prompt'
      ? `Analyze the following detailed topic/instructions and create a comprehensive, engaging presentation deck with exactly ${request.slideCount} slides based on this prompt.`
      : `Analyze the following article content and create a structured presentation deck with exactly ${request.slideCount} slides summarizing the key points.`;

  return `You are an expert content creator. ${contentInstruction}

${request.mode === 'prompt' ? 'TOPIC / INSTRUCTIONS:' : 'ARTICLE CONTENT:'}
"""
${request.articleContent}
"""

ILLUSTRATION STYLE: ${styleGuide}

Return ONLY valid JSON (no markdown, no code blocks) with this exact structure:
{
  "slides": [
    {
      "title": "Slide Title",
      "subtitle": "Optional subtitle or tagline",
      "bulletPoints": ["Key point 1", "Key point 2", "Key point 3"],
      "notes": "Speaker notes or blog paragraph for this slide",
      "imagePrompt": "Detailed image generation prompt for this slide following the illustration style. Should describe a specific visual scene that represents the slide content. Include composition details, key visual elements, and style-specific instructions."
    }
  ],
  "captions": {
    "blog": {
      "seoTitle": "SEO-optimized blog title (60 chars max)",
      "metaDescription": "Meta description (160 chars max)",
      "introText": "Engaging 2-3 sentence blog introduction",
      "sections": ["Full blog paragraph for each section based on the slides"],
      "tags": ["relevant", "tags", "for", "the", "article"]
    },
    "twitter": {
      "singles": [
        "Tweet 1 with hook + CTA (280 chars max)",
        "Tweet 2 alternative angle (280 chars max)",
        "Tweet 3 question/engagement (280 chars max)"
      ],
      "thread": "1/ Thread hook\\n\\n2/ Key insight 1\\n\\n3/ Key insight 2\\n\\n4/ Call to action"
    }
  }
}

REQUIREMENTS:
- Exactly ${request.slideCount} slides
- First slide = attention-grabbing hook/title slide
- Last slide = summary with call-to-action
- Each imagePrompt must be detailed (50-150 words) and follow the ${request.illustrationStyle} visual style
- imagePrompt should describe a VISUAL SCENE, not just text — think about what objects, characters, and compositions to show
- Blog sections should be full paragraphs, not just slide bullets
- Twitter singles should be standalone posts with hooks and CTAs
- Thread should tell a complete story across 4-6 tweets
- Keep bullet points to 3-5 per slide maximum
- Extract real data, metrics, and specific details from the article`;
}
