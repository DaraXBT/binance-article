import { NextRequest, NextResponse } from 'next/server';
import { getDeckWithAssets, updateDeckProject } from '@/lib/db';
import { UpdateDeckProjectSchema } from '@/lib/schemas';
import prisma from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const deckId = (await params).id;
    const deck = await getDeckWithAssets(deckId);

    if (!deck) {
      return NextResponse.json(
        { error: 'Deck not found' },
        { status: 404 }
      );
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
    const deckId = (await params).id;
    const body = await request.json();

    // Only allow updating known fields
    const { title, description, theme, status } = body;
    const data: Record<string, string> = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (theme !== undefined) data.theme = theme;
    if (status !== undefined) data.status = status;

    const deck = await updateDeckProject(deckId, data);
    return NextResponse.json(deck);
  } catch (error) {
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
    const deckId = (await params).id;

    await prisma.deckProject.delete({
      where: { id: deckId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error deleting deck:', error);
    return NextResponse.json(
      { error: 'Failed to delete deck' },
      { status: 500 }
    );
  }
}
