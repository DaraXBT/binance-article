import { NextRequest, NextResponse } from 'next/server';
import { generatePlainTextWithGemini, normalizeGeminiError } from '@/lib/gemini';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title } = body;

    if (!title || typeof title !== 'string' || title.trim().length < 1) {
      return NextResponse.json(
        { error: 'A topic title is required' },
        { status: 400 }
      );
    }

    const generatedPrompt = await generatePlainTextWithGemini(
      `You are a content strategist who generates detailed article prompts.

Given the TOPIC TITLE below, generate a comprehensive set of detailed instructions (a prompt) that can be used to create a high-quality article and presentation about this topic.

TOPIC TITLE: "${title.trim()}"

Your output should be a well-structured prompt/instruction set that includes:
1. A clear directive of what the article should cover
2. 3-5 specific subtopics or angles to explore
3. The target audience and tone
4. Key data points, trends, or examples to include
5. A suggested narrative arc (hook → body → conclusion)

Write it as a single cohesive paragraph or short set of instructions (150-300 words). Do NOT use markdown formatting, headers, or bullet points — write flowing text that reads like detailed instructions.

Output ONLY the prompt text, nothing else. No preamble, no "Here's your prompt:" prefix.`
    );

    if (!generatedPrompt) {
      return NextResponse.json(
        { error: 'AI returned an empty response' },
        { status: 500 }
      );
    }

    return NextResponse.json({ prompt: generatedPrompt });
  } catch (error) {
    console.error('[API] Error generating prompt:', error);
    const normalizedError = normalizeGeminiError(error, 'Failed to generate prompt');

    return NextResponse.json(
      {
        error: normalizedError.message,
        code: normalizedError.providerCode,
        retryAfterSeconds: normalizedError.retryAfterSeconds,
        model: normalizedError.model,
      },
      { status: normalizedError.statusCode }
    );
  }
}
