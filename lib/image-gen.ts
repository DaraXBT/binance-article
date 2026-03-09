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

function getImageModel() {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY environment variable is not set');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-preview-image-generation',
  });
}

/**
 * Generate an image using Google Gemini's image generation capability.
 * Returns the image as a Buffer.
 */
export async function generateImage(prompt: string): Promise<Buffer | null> {
  try {
    const model = getImageModel();

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Generate an illustration image. Do not include any text in the image. Create a high-quality, detailed, visually striking illustration:\n\n${prompt}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      } as any,
    });

    // Extract image from response
    const response = result.response;
    const candidates = response.candidates;

    if (!candidates || candidates.length === 0) {
      console.warn('[ImageGen] No candidates in response');
      return null;
    }

    for (const part of candidates[0].content.parts) {
      if ((part as any).inlineData) {
        const imageData = (part as any).inlineData;
        const buffer = Buffer.from(imageData.data, 'base64');
        console.log(`[ImageGen] Image generated: ${buffer.length} bytes`);
        return buffer;
      }
    }

    console.warn('[ImageGen] No image data in response parts');
    return null;
  } catch (error) {
    console.error('[ImageGen] Error generating image:', error);
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
  filename: string
): Promise<string> {
  const { url } = await put(filename, imageBuffer, {
    access: 'public',
    contentType: 'image/png',
  });

  return url;
}

/**
 * Build the full image prompt by combining style description with slide-specific prompt.
 */
export function buildImagePrompt(styleDescription: string, slidePrompt: string): string {
  return `${styleDescription}\n\n---\n\nGenerate an illustration following the style above. Content:\n${slidePrompt}`;
}
