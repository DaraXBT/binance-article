'use client';

import { useState, use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Slide } from '@prisma/client';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { SlideList } from '@/components/slide-list';
import { SlideEditor } from '@/components/slide-editor';
import { SlidePreview } from '@/components/slide-preview';
import { CaptionViewer } from '@/components/caption-viewer';
import { Spinner } from '@/components/ui/spinner';
import { Download, Share2, RotateCcw } from 'lucide-react';
import Link from 'next/link';

interface DeckPageProps {
  params: Promise<{ id: string }>;
}

export default function DeckPage({ params }: DeckPageProps) {
  const { id: deckId } = use(params);
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null);

  const { data: deck, isLoading, isError } = useQuery({
    queryKey: ['deck', deckId],
    queryFn: async () => {
      const res = await fetch(`/api/decks/${deckId}`);
      if (!res.ok) throw new Error('Failed to fetch deck');
      return res.json();
    },
    staleTime: 10000,
  });

  // Set first slide as active when slides load
  if (deck?.slides && !activeSlideId && deck.slides.length > 0) {
    setActiveSlideId(deck.slides[0].id);
  }

  const activeSlide = deck?.slides?.find((s: Slide) => s.id === activeSlideId) || null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner />
      </div>
    );
  }

  if (isError || !deck) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-destructive">Failed to load deck</p>
        <Link href="/">
          <Button variant="outline">Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  const slides: Slide[] = deck.slides || [];

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="border-b border-border bg-background sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <Link href="/" className="text-muted-foreground hover:text-foreground text-sm">
              ← Back
            </Link>
            <h1 className="text-2xl font-bold">{deck.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-2">
              <Share2 className="h-4 w-4" />
              Share
            </Button>
            <Button size="sm" variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* Left Panel: Slide List */}
          <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
            <SlideList
              slides={slides}
              activeSlideId={activeSlideId}
              onSelectSlide={setActiveSlideId}
            />
          </ResizablePanel>

          <ResizableHandle />

          {/* Center Panel: Editor */}
          <ResizablePanel defaultSize={30} minSize={25} maxSize={50}>
            <div className="overflow-y-auto h-full p-6 border-r border-border">
              <SlideEditor slide={activeSlide} />
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* Right Panel: Preview & Captions */}
          <ResizablePanel defaultSize={50} minSize={30}>
            <ResizablePanelGroup direction="vertical">
              {/* Preview */}
              <ResizablePanel defaultSize={60} minSize={30}>
                <div className="p-6 overflow-auto h-full">
                  <SlidePreview slide={activeSlide} theme={deck.theme} />
                </div>
              </ResizablePanel>

              <ResizableHandle />

              {/* Captions */}
              <ResizablePanel defaultSize={40} minSize={20}>
                <CaptionViewer captions={deck.captions} />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
