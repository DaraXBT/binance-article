import { NextRequest, NextResponse } from 'next/server';
import { getDeckWithAssets } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deckId = params.id;
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
      {
        error: 'Failed to fetch deck',
      },
      { status: 500 }
    );
  }
}
