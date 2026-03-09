'use client';

import { Slide } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Plus, GripVertical } from 'lucide-react';

interface SlideListProps {
  slides: Slide[];
  activeSlideId: string | null;
  onSelectSlide: (slideId: string) => void;
  onAddSlide?: () => void;
}

export function SlideList({
  slides,
  activeSlideId,
  onSelectSlide,
  onAddSlide,
}: SlideListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="font-semibold">Slides ({slides.length})</h3>
        {onAddSlide && (
          <Button size="sm" variant="outline" onClick={onAddSlide} className="gap-2">
            <Plus className="h-4 w-4" />
            Add
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 p-4">
        {slides.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No slides yet
          </p>
        ) : (
          slides.map((slide) => (
            <button
              key={slide.id}
              onClick={() => onSelectSlide(slide.id)}
              className={`w-full text-left p-3 rounded-lg border transition-all ${
                activeSlideId === slide.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="flex items-start gap-2">
                <GripVertical className="h-4 w-4 mt-1 flex-shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{slide.title}</p>
                  {slide.subtitle && (
                    <p className="text-xs text-muted-foreground truncate">
                      {slide.subtitle}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Slide {slide.order + 1}
                  </p>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
