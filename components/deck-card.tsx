'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MoreVertical, Presentation, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

interface DeckCardProps {
  id: string;
  title: string;
  description?: string;
  slideCount: number;
  createdAt: string;
  updatedAt: string;
}

export function DeckCard({
  id,
  title,
  description,
  slideCount,
  createdAt,
  updatedAt,
}: DeckCardProps) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg">{title}</CardTitle>
            {description && (
              <CardDescription className="line-clamp-2 mt-1">
                {description}
              </CardDescription>
            )}
          </div>
          <Button variant="ghost" size="sm">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Presentation className="h-4 w-4" />
            <span>{slideCount} slide{slideCount !== 1 ? 's' : ''}</span>
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <div>
              Updated{' '}
              {formatDistanceToNow(new Date(updatedAt), {
                addSuffix: true,
              })}
            </div>
          </div>
          <Link href={`/decks/${id}`} className="block">
            <Button className="w-full" variant="default">
              Open Deck
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
