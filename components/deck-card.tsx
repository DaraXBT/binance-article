'use client';

import Link from 'next/link';
import { ArrowUpRight, Clock3, Presentation } from 'lucide-react';

import { useLanguage } from '@/components/language-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/i18n';

interface DeckCardProps {
  id: string;
  title: string;
  description?: string;
  slideCount: number;
  createdAt: string;
  updatedAt: string;
  status?: string;
}

const statusStyles: Record<string, { className: string }> = {
  draft: {
    className: 'border-amber-500/20 bg-amber-500/10 text-amber-700',
  },
  queued: {
    className: 'border-violet-500/20 bg-violet-500/10 text-violet-700',
  },
  generating: {
    className: 'border-sky-500/20 bg-sky-500/10 text-sky-700',
  },
  ready: {
    className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700',
  },
  rendering: {
    className: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-700',
  },
  failed: {
    className: 'border-destructive/20 bg-destructive/10 text-destructive',
  },
};

export function DeckCard({
  id,
  title,
  description,
  slideCount,
  createdAt,
  updatedAt,
  status = 'draft',
}: DeckCardProps) {
  const { language, messages } = useLanguage();

  const statusLabel =
    messages.deckCard.status[status as keyof typeof messages.deckCard.status] ??
    status.charAt(0).toUpperCase() + status.slice(1);

  const statusMeta = statusStyles[status] ?? {
    className: 'border-border/70 bg-secondary text-secondary-foreground',
  };

  return (
    <Card className="group overflow-hidden -[2rem] border-border/60 bg-background/80 py-0 shadow-[0_28px_80px_-56px_rgba(12,14,18,0.55)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_36px_96px_-56px_rgba(12,14,18,0.7)]">
      <div className="h-1 w-full bg-gradient-to-r from-[#F0B90B] via-[#02C076] to-[#0EA5E9]" />

      <CardHeader className="gap-2 px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Badge
              variant="outline"
              className={` px-2 py-0.5 text-[10px] tracking-[0.1em] uppercase ${statusMeta.className}`}
            >
              {statusLabel}
            </Badge>

            <div className="space-y-1">
              <CardTitle className="text-lg font-semibold leading-tight tracking-tight text-foreground">
                {title}
              </CardTitle>
              <CardDescription className="line-clamp-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
                {description || messages.deckCard.fallbackDescription}
              </CardDescription>
            </div>
          </div>

          <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-border/60 bg-background/90 text-foreground transition-colors group-hover:bg-foreground group-hover:text-background">
            <Presentation className="h-4 w-4" />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 px-4 pb-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="border border-border/60 bg-background/90 p-3">
            <p className="text-[10px] font-medium tracking-[0.15em] text-muted-foreground uppercase">
              {messages.deckCard.slides}
            </p>
            <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">
              {slideCount}
            </p>
          </div>

          <div className="border border-border/60 bg-background/90 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-medium tracking-[0.15em] text-muted-foreground uppercase">
              <Clock3 className="h-3 w-3" />
              {messages.deckCard.updated}
            </div>
            <p className="mt-1 text-sm font-semibold tracking-tight text-foreground">
              {formatRelativeTime(new Date(updatedAt), language)}
            </p>
          </div>
        </div>
      </CardContent>

      <CardFooter className="mt-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3 border-t border-border/60 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          {messages.deckCard.created} {formatRelativeTime(new Date(createdAt), language)}
        </p>

        <Button asChild className=" px-4 w-full sm:w-auto">
          <Link href={`/articles/${id}`}>
            {messages.deckCard.openDeck}
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
