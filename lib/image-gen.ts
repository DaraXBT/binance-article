import { GoogleGenerativeAI } from '@google/generative-ai';
import { put } from '@vercel/blob';

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

function getGenAI() {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY environment variable is not set');
  }
  return new GoogleGenerativeAI(apiKey);
}

export interface ImageGenerationResult {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Generate an image using Google Gemini's image generation capability.
 * Returns the image as a Buffer and its MIME type.
 */
export async function generateImage(prompt: string): Promise<ImageGenerationResult | null> {
  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-pro-image-preview',
    });

    console.log('[ImageGen] Calling Gemini with prompt length:', prompt.length);

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Create an illustration image for the following description. Output ONLY the image, no text:\n\n${prompt}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
      } as any,
    });

    // Extract image from response
    const response = result.response;
    const candidates = response.candidates;

    console.log('[ImageGen] Response candidates count:', candidates?.length ?? 0);

    if (!candidates || candidates.length === 0) {
      console.warn('[ImageGen] No candidates in response');
      // Check for prompt feedback (safety blocks)
      const feedback = (response as any).promptFeedback;
      if (feedback) {
        console.warn('[ImageGen] Prompt feedback:', JSON.stringify(feedback));
      }
      return null;
    }

    const parts = candidates[0].content?.parts || [];
    console.log('[ImageGen] Response parts count:', parts.length);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as any;
      console.log(`[ImageGen] Part ${i} type:`, part.text ? 'text' : part.inlineData ? `inlineData(${part.inlineData.mimeType})` : 'unknown');
      if (part.inlineData) {
        const buffer = Buffer.from(part.inlineData.data, 'base64');
        const mimeType = part.inlineData.mimeType || 'image/jpeg';
        console.log(`[ImageGen] ✅ Image extracted: ${buffer.length} bytes, type: ${mimeType}`);
        return { buffer, mimeType };
      }
    }

    // Log any text response for debugging
    const textPart = parts.find((p: any) => p.text);
    if (textPart) {
      console.warn('[ImageGen] Got text instead of image:', (textPart as any).text?.slice(0, 200));
    }

    console.warn('[ImageGen] No image data found in response parts');
    return null;
  } catch (error: any) {
    console.error('[ImageGen] Error:', error?.message || error);
    if (error?.response) {
      console.error('[ImageGen] Error response:', JSON.stringify(error.response));
    }
    return null;
  }
}

/**
 * Get embedded style description (no filesystem needed).
 */
export function getStyleDescription(illustrationStyle: string): string {
  return STYLE_DESCRIPTIONS[illustrationStyle] || STYLE_DESCRIPTIONS['pixel-art'];
}

/**
 * Upload an image buffer to Vercel Blob storage.
 * Returns the public URL.
 */
export async function uploadToBlob(
  imageBuffer: Buffer,
  filename: string,
  contentType: string = 'image/jpeg'
): Promise<string> {
  try {
    // Try public access first (ideal for images needed in browser)
    const { url } = await put(filename, imageBuffer, {
      access: 'public',
      contentType,
      allowOverwrite: true,
    });
    return url;
  } catch (err: any) {
    // Fallback if the store was created as a "private" store or other config error
    console.warn('[Blob] Public upload failed, falling back to private access upload', err?.message);
    const { url } = await put(filename, imageBuffer, {
      access: 'private',
      contentType,
      allowOverwrite: true,
    });
    return url;
  }
}

/**
 * Build the full image prompt by combining style description with slide-specific prompt.
 */
export function buildImagePrompt(styleDescription: string, slidePrompt: string): string {
  return `${styleDescription}\n\n---\n\nGenerate an illustration following the style above. Content:\n${slidePrompt}`;
}
