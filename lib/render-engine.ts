import { Slide } from '@prisma/client';
import { THEME_PRESETS } from './config';
import * as fs from 'fs';
import * as path from 'path';

export interface RenderOutput {
  pngPath: string;
  pptxPath: string;
  pdfPath: string;
}

export interface RenderContext {
  deckId: string;
  theme: string;
  slides: Slide[];
  outputDir: string;
}

/**
 * Mock render engine - generates placeholder files
 * In production, this would use a real rendering library like:
 * - Playwright/Puppeteer for PNG
 * - officegen for PPTX
 * - PDFKit for PDF
 */
export async function renderDeck(context: RenderContext): Promise<RenderOutput> {
  const { deckId, theme, slides, outputDir } = context;

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate placeholder files with actual content
  const pngPath = path.join(outputDir, `${deckId}-slides.png`);
  const pptxPath = path.join(outputDir, `${deckId}-presentation.pptx`);
  const pdfPath = path.join(outputDir, `${deckId}-export.pdf`);

  // Create mock PNG with content
  const slideInfo = slides
    .sort((a, b) => a.order - b.order)
    .map(
      (s) =>
        `Slide ${s.order + 1}: ${s.title}\n${s.bulletPoints.join('\n')}`
    )
    .join('\n\n---\n\n');

  const pngContent = `DECK: ${deckId}\nTHEME: ${theme}\n\n${slideInfo}`;
  fs.writeFileSync(pngPath, pngContent, 'utf-8');

  // Create mock PPTX
  const pptxContent = generateMockPptxContent(deckId, theme, slides);
  fs.writeFileSync(pptxPath, pptxContent);

  // Create mock PDF
  const pdfContent = `%%PDF-1.4\n%Mock PDF for ${deckId}\n${pngContent}\n%%EOF`;
  fs.writeFileSync(pdfPath, pdfContent, 'utf-8');

  return { pngPath, pptxPath, pdfPath };
}

function generateMockPptxContent(
  deckId: string,
  theme: string,
  slides: Slide[]
): Buffer {
  // This is a simplified mock - real PPTX generation would use a proper library
  const metadata = `PPTX Mock File\nDeck ID: ${deckId}\nTheme: ${theme}\nSlides: ${slides.length}`;
  return Buffer.from(metadata, 'utf-8');
}

export function getThemeStyles(themeName: string) {
  const theme = THEME_PRESETS[themeName as keyof typeof THEME_PRESETS];
  return theme ? theme.colors : THEME_PRESETS.default.colors;
}

export interface ThemeColors {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  accent: string;
}

export function validateTheme(themeName: string): boolean {
  return themeName in THEME_PRESETS;
}
