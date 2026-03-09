import { GoogleGenerativeAI } from '@google/generative-ai';
import { DeckGenerateRequest, SlideContent } from './schemas';

function getModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
}

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

export async function generateDeckWithGemini(
  request: DeckGenerateRequest
): Promise<GeneratedDeckResponse> {
  const prompt = buildGenerationPrompt(request);

  const model = getModel();
  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  // Parse JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse Gemini response as JSON');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Validate slides
  if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error('No slides generated');
  }

  const slides: GeneratedSlideWithPrompt[] = parsed.slides.map((slide: any, index: number) => ({
    title: slide.title || 'Untitled Slide',
    subtitle: slide.subtitle || '',
    bulletPoints: Array.isArray(slide.bulletPoints) ? slide.bulletPoints : [],
    notes: slide.notes || '',
    imagePrompt: slide.imagePrompt || `Illustration for: ${slide.title}`,
    order: index,
  }));

  // Parse captions from the same response
  const captions: GeneratedCaptionPackage = {
    blog: {
      seoTitle: parsed.captions?.blog?.seoTitle || parsed.slides?.[0]?.title || 'Article',
      metaDescription: parsed.captions?.blog?.metaDescription || '',
      introText: parsed.captions?.blog?.introText || '',
      sections: parsed.captions?.blog?.sections || slides.map((s) => s.title),
      tags: parsed.captions?.blog?.tags || [],
    },
    twitter: {
      singles: parsed.captions?.twitter?.singles || [],
      thread: parsed.captions?.twitter?.thread || '',
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

function buildGenerationPrompt(request: DeckGenerateRequest): string {
  const styleDescriptions: Record<string, string> = {
    'pixel-art': 'Binance × Retro 8-Bit: dark crypto-native style with chunky pixel art, isometric scenes, gold (#F0B90B) hero accent on Canvas Black (#0C0E12). Pixel grid alignment, dithering, staircase edges, retro sprites.',
    'fantasy-animation': 'Binance × Enchanted Storybook: dark isometric with gold-led structure, painterly warmth, magical narrative glow. Lantern light highlights, expressive characters, soft ember accents on Canvas Black.',
    'lab-notes': 'Binance × Lab Notes: dark isometric with sparse technical annotations and research-note clarity. One hero mechanism, 2-4 compact labels, figure markers, leader lines on Canvas Black.',
  };

  const styleGuide = styleDescriptions[request.illustrationStyle] || styleDescriptions['pixel-art'];

  return `You are an expert content creator. Analyze the following article and create a structured presentation deck with exactly ${request.slideCount} slides.

ARTICLE:
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
