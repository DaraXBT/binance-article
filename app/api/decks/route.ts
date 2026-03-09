import { NextRequest, NextResponse } from 'next/server';
import { createDeckProject, listDeckProjects } from '@/lib/db';
import { CreateDeckProjectSchema } from '@/lib/schemas';
import { getSessionId } from '@/lib/session';

export async function POST(request: NextRequest) {
  try {
    const sessionId = await getSessionId();
    const body = await request.json();
    const validated = CreateDeckProjectSchema.parse(body);

    const deck = await createDeckProject(
      validated.title,
      validated.content,
      validated.description,
      validated.illustrationStyle,
      sessionId
    );

    return NextResponse.json(deck, { status: 201 });
  } catch (error) {
    console.error('[API] Error creating deck:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create deck',
      },
      { status: 400 }
    );
  }
}

export async function GET() {
  try {
    const sessionId = await getSessionId();
    const decks = await listDeckProjects(sessionId, 20);
    return NextResponse.json(decks);
  } catch (error) {
    console.error('[API] Error fetching decks:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch decks',
      },
      { status: 500 }
    );
  }
}
