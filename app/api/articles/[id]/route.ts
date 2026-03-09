import { NextRequest, NextResponse } from 'next/server';
import { deleteDeckProject, getDeckWithAssets, updateDeckProject } from '@/lib/db';
import { deleteDeckAssets } from '@/lib/file-utils';
import { UpdateDeckProjectSchema } from '@/lib/schemas';
import { getCurrentWorkspace } from '@/lib/workspace';

function isNotFoundError(error: unknown) {
  return error instanceof Error && /not found/i.test(error.message);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspace } = await getCurrentWorkspace();
    const deckId = (await params).id;
    const deck = await getDeckWithAssets(deckId, workspace.id);

    if (!deck) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }

    return NextResponse.json(deck);
  } catch (error) {
    console.error('[API] Error fetching deck:', error);
    return NextResponse.json(
      { error: 'Failed to fetch deck' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspace } = await getCurrentWorkspace();
    const deckId = (await params).id;
    const body = await request.json();
    const data = UpdateDeckProjectSchema.parse(body);

    const deck = await updateDeckProject(deckId, workspace.id, data);
    return NextResponse.json(deck);
  } catch (error) {
    if (isNotFoundError(error)) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }

    console.error('[API] Error updating deck:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update deck' },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspace } = await getCurrentWorkspace();
    const deckId = (await params).id;

    await deleteDeckProject(deckId, workspace.id);
    deleteDeckAssets(deckId);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }

    console.error('[API] Error deleting deck:', error);
    return NextResponse.json(
      { error: 'Failed to delete deck' },
      { status: 500 }
    );
  }
}
