import { GoogleGenerativeAI } from '@google/generative-ai';
import { put } from '@vercel/blob';
import fs from 'fs/promises';
import path from 'path';

function getImageModel() {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY environment variable is not set');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
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
              text: `Generate an image based on this description. Create a high-quality, detailed illustration:\n\n${prompt}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'] as any,
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
        return buffer;
      }
    }

    console.warn('[ImageGen] No image data in response');
    return null;
  } catch (error) {
    console.error('[ImageGen] Error generating image:', error);
    return null;
  }
}

/**
 * Read a style reference file and return its content.
 */
export async function getStyleReference(illustrationStyle: string): Promise<string> {
  const STYLE_FILES: Record<string, string> = {
    'pixel-art': 'binance-pixel-art.md',
    'fantasy-animation': 'binance-fantasy-animation.md',
    'lab-notes': 'binance-lab-notes.md',
  };

  const styleFileName = STYLE_FILES[illustrationStyle] || STYLE_FILES['pixel-art'];
  const styleFilePath = path.join(
    process.cwd(),
    '.agents',
    'skills',
    'baoyu-article-illustrator',
    'references',
    'styles',
    styleFileName
  );

  try {
    return await fs.readFile(styleFilePath, 'utf-8');
  } catch {
    console.warn(`[ImageGen] Style file not found: ${styleFilePath}`);
    return '';
  }
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
 * Build the full image prompt by combining style reference with slide-specific prompt.
 */
export function buildImagePrompt(styleContext: string, slidePrompt: string): string {
  if (styleContext) {
    return `${styleContext}\n\n---\n\nGenerate an illustration following the style above. Content:\n${slidePrompt}`;
  }
  return slidePrompt;
}
