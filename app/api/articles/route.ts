import { NextRequest, NextResponse } from 'next/server';
import { createDeckProject, listDeckProjects } from '@/lib/db';
import { CreateDeckProjectSchema } from '@/lib/schemas';
import { getCurrentWorkspace } from '@/server/modules/workspace/service';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const { workspace } = await getCurrentWorkspace();
    const body = await request.json();
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
      status: 400,
    });
  }
}

export async function GET() {
  try {
    const { workspace } = await getCurrentWorkspace();
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
