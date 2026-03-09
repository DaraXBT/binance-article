'use client';

import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Plus, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { DeckCard } from '@/components/deck-card';
import { Empty } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';

async function fetchDecks() {
  const res = await fetch('/api/decks');
  if (!res.ok) throw new Error('Failed to fetch decks');
  return res.json();
}

export default function DashboardPage() {
  const { data: decks = [], isLoading, isError } = useQuery({
    queryKey: ['decks'],
    queryFn: fetchDecks,
    staleTime: 30000,
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-secondary/10">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col gap-2 mb-8">
          <h1 className="text-4xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              DeckForge
            </span>
          </h1>
          <p className="text-lg text-muted-foreground">
            Create beautiful presentation decks with AI
          </p>
        </div>

        {/* Create New Deck CTA */}
        <div className="mb-12">
          <Link href="/new">
            <Button size="lg" className="gap-2">
              <Plus className="h-5 w-5" />
              Create New Deck
            </Button>
          </Link>
        </div>

        {/* Recent Decks Section */}
        <div>
          <div className="mb-6">
            <h2 className="text-2xl font-semibold mb-2">Recent Decks</h2>
            <p className="text-muted-foreground">
              {decks.length > 0
                ? `You have ${decks.length} deck${decks.length !== 1 ? 's' : ''}`
                : 'No decks yet'}
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-2">
                <Spinner />
                <p className="text-muted-foreground">Loading decks...</p>
              </div>
            </div>
          ) : isError ? (
            <div className="text-center py-12">
              <p className="text-destructive mb-4">
                Failed to load decks. Please try again.
              </p>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </div>
          ) : decks.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {decks.map((deck: any) => (
                <DeckCard
                  key={deck.id}
                  id={deck.id}
                  title={deck.title}
                  description={deck.description}
                  slideCount={deck._count?.slides || 0}
                  createdAt={deck.createdAt}
                  updatedAt={deck.updatedAt}
                />
              ))}
            </div>
          ) : (
            <Empty
              title="No decks yet"
              description="Create your first presentation deck with AI. Click the button above to get started."
              icon="presentation"
            />
          )}
        </div>
      </div>
    </div>
  );
}
