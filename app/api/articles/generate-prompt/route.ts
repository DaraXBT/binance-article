import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generatePlainTextWithGemini } from '@/lib/gemini';
import { getRequestGenerateAccessState, isGenerateAccessEnabled } from '@/lib/generate-access';
import { createGenerateAccessRequiredResponse } from '@/server/auth/generate-access-response';
import { requireActiveUser } from '@/server/auth/authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { requireActorWorkspace } from '@/server/modules/workspace/membership';

export const maxDuration = 30;
const TopicSchema = z.string().trim().min(1).max(200);

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const actor = await requireActiveUser(request);
    const workspace = await requireActorWorkspace(getRuntimeDatabase(), actor.id);
    const body = await readBoundedJson(request, 1_024);

    if (isGenerateAccessEnabled()) {
      const accessState = await getRequestGenerateAccessState(request, {
        workspaceId: workspace.id,
        sessionId: actor.sessionId,
      });

      if (!accessState.hasAccess) {
        return createGenerateAccessRequiredResponse({
          reason: accessState.invalidReason,
          clearCookie: accessState.invalidReason !== 'missing',
        });
      }
    }

    const parsedTitle = TopicSchema.safeParse(
      typeof body === 'object' && body !== null ? (body as { title?: unknown }).title : undefined,
    );
    if (!parsedTitle.success) {
      return NextResponse.json(
        { error: 'A topic title is required', code: 'TOPIC_REQUIRED' },
        { status: 400, headers: withNoStoreHeaders() }
      );
    }

    const generatedPrompt = await generatePlainTextWithGemini(
      `You are a content strategist who generates detailed article prompts.

Given the TOPIC TITLE below, generate a comprehensive set of detailed instructions (a prompt) that can be used to create a high-quality article and presentation about this topic.

TOPIC TITLE: "${parsedTitle.data}"

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
        { status: 500, headers: withNoStoreHeaders() }
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
