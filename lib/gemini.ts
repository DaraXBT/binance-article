import { GoogleGenerativeAI } from '@google/generative-ai';
import { DeckGenerateRequest, SlideContent, CaptionPackage } from './schemas';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error('GEMINI_API_KEY environment variable is not set');
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

export interface GeneratedDeckResponse {
  slides: SlideContent[];
  captions: CaptionPackage;
  metadata: {
    totalSlides: number;
    generatedAt: string;
  };
}

export async function generateDeckWithGemini(
  request: DeckGenerateRequest
): Promise<GeneratedDeckResponse> {
  const prompt = buildGenerationPrompt(request);

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

  const slides: SlideContent[] = parsed.slides.map((slide: any, index: number) => ({
    id: `slide-${index}`,
    title: slide.title || 'Untitled Slide',
    subtitle: slide.subtitle || '',
    bulletPoints: Array.isArray(slide.bulletPoints) ? slide.bulletPoints : [],
    notes: slide.notes || '',
    order: index,
  }));

  // Generate captions
  const captions = await generateCaptions(slides, request.topic);

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
  return `You are an expert presentation designer. Generate a structured presentation with ${request.slideCount} slides about: "${request.topic}"

${request.targetAudience ? `Target Audience: ${request.targetAudience}` : ''}
${request.style ? `Style: ${request.style}` : ''}
${request.additionalNotes ? `Additional Notes: ${request.additionalNotes}` : ''}

Return ONLY valid JSON (no markdown, no code blocks) with this structure:
{
  "slides": [
    {
      "title": "Slide Title",
      "subtitle": "Optional subtitle or tagline",
      "bulletPoints": ["Point 1", "Point 2", "Point 3"],
      "notes": "Speaker notes or additional context"
    }
  ]
}

Requirements:
- Each slide should have a clear, concise title
- Bullet points should be specific and actionable
- Total ${request.slideCount} slides
- First slide should be a title/cover slide
- Last slide should be a conclusion/call-to-action
- Keep bullet points to 3-5 per slide maximum`;
}

async function generateCaptions(
  slides: SlideContent[],
  topic: string
): Promise<CaptionPackage> {
  const captionPrompt = `Given these slide titles from a presentation about "${topic}":
${slides.map((s, i) => `${i + 1}. ${s.title}`).join('\n')}

Generate captions in this JSON format:
{
  "blog": {
    "seoTitle": "SEO-optimized title (60 chars max)",
    "metaDescription": "Meta description (160 chars max)",
    "introText": "Engaging 2-3 sentence introduction",
    "sections": ["Section 1 content", "Section 2 content"],
    "tags": ["tag1", "tag2", "tag3"]
  },
  "twitter": {
    "singles": [
      "Tweet 1",
      "Tweet 2",
      "Tweet 3"
    ],
    "thread": "Tweet 1\n\n2/ Tweet 2\n\n3/ Tweet 3"
  }
}`;

  const result = await model.generateContent(captionPrompt);
  const responseText = result.response.text();

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Return default captions if generation fails
    return {
      blog: {
        seoTitle: topic,
        metaDescription: `Learn about ${topic}`,
        introText: `This presentation covers key aspects of ${topic}.`,
        sections: slides.slice(1, -1).map(s => s.title),
        tags: [topic.toLowerCase()],
      },
      twitter: {
        singles: [
          `Just finished a great presentation on ${topic}!`,
          `Key insights from our ${topic} deck.`,
          `Check out our latest ${topic} content.`,
        ],
        thread: `1/ New thread on ${topic}\n\n2/ Here are the key takeaways\n\n3/ What do you think?`,
      },
    };
  }

  return JSON.parse(jsonMatch[0]);
}
