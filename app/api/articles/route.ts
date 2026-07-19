import { NextRequest, NextResponse } from 'next/server';
import { createDeckProject, listDeckProjects } from '@/lib/db';
import { getRequestGenerateAccessState, isGenerateAccessEnabled } from '@/lib/generate-access';
import { CreateDeckProjectSchema } from '@/lib/schemas';
import { createGenerateAccessRequiredResponse } from '@/server/auth/generate-access-response';
import { requireActiveUser } from '@/server/auth/authorization';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { requireActorWorkspace } from '@/server/modules/workspace/membership';

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const actor = await requireActiveUser(request);
    const workspace = await requireActorWorkspace(getRuntimeDatabase(), actor.id);
    const body = await readBoundedJson(request, 64_000);

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

    const validated = CreateDeckProjectSchema.parse(body);

    const deck = await createDeckProject(
      validated.title,
      validated.content,
      validated.description,
      validated.illustrationStyle,
      workspace.id
    );

    return NextResponse.json(deck, { status: 201, headers: withNoStoreHeaders() });
  } catch (error) {
    return errorResponse(error, {
      code: 'ARTICLE_CREATE_FAILED',
      message: 'Failed to create article.',
      status: 500,
    });
  }
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActiveUser(request);
    const workspace = await requireActorWorkspace(getRuntimeDatabase(), actor.id);
    const decks = await listDeckProjects(workspace.id, 20);
    return NextResponse.json(decks, {
      headers: withNoStoreHeaders(),
    });
  } catch (error) {
    return errorResponse(error, {
      code: 'ARTICLE_LIST_FAILED',
      message: 'Failed to fetch articles.',
      status: 500,
    });
  }
}
