import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execFileAsync = promisify(execFile);

// Style reference file mapping
const STYLE_FILES: Record<string, string> = {
  'pixel-art': 'binance-pixel-art.md',
  'fantasy-animation': 'binance-fantasy-animation.md',
  'lab-notes': 'binance-lab-notes.md',
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const deckId = (await params).id;
    const body = await request.json();
    const illustrationStyle = body.illustrationStyle || 'pixel-art';

    // Get deck with slides
    const deck = await prisma.deckProject.findUnique({
      where: { id: deckId },
      include: {
        slides: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!deck) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }

    // Create output directory
    const outputDir = path.join(process.cwd(), 'public', 'renders', deckId);
    await fs.mkdir(outputDir, { recursive: true });

    // Read style reference file for the prompt
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

    let styleContext = '';
    try {
      styleContext = await fs.readFile(styleFilePath, 'utf-8');
    } catch {
      console.warn(`[ImageGen] Style file not found: ${styleFilePath}, using fallback`);
    }

    // Generate images for each slide
    const results: { slideId: string; imageUrl: string | null; error?: string }[] = [];

    // Find the baoyu-image-gen script
    const skillDir = path.join(process.cwd(), '.agents', 'skills', 'baoyu-image-gen');
    const scriptPath = path.join(skillDir, 'scripts', 'main.ts');

    for (const slide of deck.slides) {
      if (!slide.imagePrompt) {
        results.push({ slideId: slide.id, imageUrl: null, error: 'No image prompt' });
        continue;
      }

      const imageFilename = `slide-${String(slide.order + 1).padStart(2, '0')}.png`;
      const imagePath = path.join(outputDir, imageFilename);
      const imageUrl = `/renders/${deckId}/${imageFilename}`;

      try {
        // Build combined prompt with style context
        const fullPrompt = styleContext
          ? `${styleContext}\n\n---\n\nGenerate an illustration following the style above. Content:\n${slide.imagePrompt}`
          : slide.imagePrompt;

        // Save prompt to temp file for promptfiles approach
        const promptFile = path.join(outputDir, `prompt-${String(slide.order + 1).padStart(2, '0')}.md`);
        await fs.writeFile(promptFile, fullPrompt, 'utf-8');

        // Try to use bun, fall back to npx
        let bunCommand = 'bun';
        try {
          await execFileAsync('which', ['bun']);
        } catch {
          bunCommand = 'npx';
        }

        const args = bunCommand === 'npx'
          ? ['-y', 'bun', scriptPath, '--promptfiles', promptFile, '--image', imagePath, '--ar', '16:9', '--quality', '2k']
          : [scriptPath, '--promptfiles', promptFile, '--image', imagePath, '--ar', '16:9', '--quality', '2k'];

        console.log(`[ImageGen] Generating image for slide ${slide.order + 1}: ${imageFilename}`);

        await execFileAsync(bunCommand, args, {
          cwd: process.cwd(),
          timeout: 120000, // 2 min timeout per image
          env: { ...process.env },
        });

        // Update slide with image URL
        await prisma.slide.update({
          where: { id: slide.id },
          data: { imageUrl },
        });

        results.push({ slideId: slide.id, imageUrl });
        console.log(`[ImageGen] ✅ Slide ${slide.order + 1} generated: ${imageFilename}`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[ImageGen] ❌ Slide ${slide.order + 1} failed:`, errorMsg);
        results.push({ slideId: slide.id, imageUrl: null, error: errorMsg });
      }
    }

    const successCount = results.filter(r => r.imageUrl).length;

    return NextResponse.json({
      success: true,
      deckId,
      generated: successCount,
      total: deck.slides.length,
      results,
    });
  } catch (error) {
    console.error('[API] Error generating images:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate images' },
      { status: 500 }
    );
  }
}
