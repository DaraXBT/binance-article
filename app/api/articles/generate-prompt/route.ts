import { NextRequest, NextResponse } from 'next/server';
import { generatePlainTextWithGemini } from '@/lib/gemini';
import { isGenerateAccessEnabled, hasGrantedGenerateAccess } from '@/lib/generate-access';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);

    if (isGenerateAccessEnabled()) {
      const hasAccess = await hasGrantedGenerateAccess(request);
      if (!hasAccess) {
        return NextResponse.json(
          { error: 'Generation access code required.', code: 'GENERATE_ACCESS_REQUIRED' },
          { status: 403, headers: withNoStoreHeaders() }
        );
      }
    }

    const body = await request.json();
    const { title } = body;

    if (!title || typeof title !== 'string' || title.trim().length < 1) {
      return NextResponse.json(
        { error: 'A topic title is required', code: 'TOPIC_REQUIRED' },
        { status: 400, headers: withNoStoreHeaders() }
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

    return NextResponse.json(
      { prompt: generatedPrompt },
      {
        headers: withNoStoreHeaders(),
      }
    );
  } catch (error) {
    return errorResponse(error, {
      code: 'PROMPT_GENERATION_FAILED',
      message: 'Failed to generate prompt.',
      status: 500,
    });
  }
}
