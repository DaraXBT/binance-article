'use client';

import { Slide } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Plus, GripVertical, ImageIcon } from 'lucide-react';

interface SlideListProps {
  slides: (Slide & { imageUrl?: string | null })[];
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
              className={`w-full text-left rounded-lg border transition-all overflow-hidden ${
                activeSlideId === slide.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              {/* Image thumbnail */}
              {slide.imageUrl ? (
                <div className="w-full h-16 bg-muted overflow-hidden">
                  <img
                    src={slide.imageUrl}
                    alt={slide.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="w-full h-10 bg-muted/50 flex items-center justify-center">
                  <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/50" />
                </div>
              )}

              {/* Slide info */}
              <div className="p-2.5">
                <div className="flex items-start gap-2">
                  <GripVertical className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-xs truncate">{slide.title}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Slide {slide.order + 1}
                    </p>
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
