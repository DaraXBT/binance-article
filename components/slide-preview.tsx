'use client';

import { Slide } from '@prisma/client';
import { ImageIcon } from 'lucide-react';

interface SlidePreviewProps {
  slide: (Slide & { imageUrl?: string | null }) | null;
  theme?: string;
}

export function SlidePreview({ slide, theme = 'default' }: SlidePreviewProps) {
  if (!slide) {
    return (
      <div className="h-full flex items-center justify-center bg-muted border border-border rounded-lg">
        <p className="text-muted-foreground">Select a slide to preview</p>
      </div>
    );
  }

  const bullets = slide.bullets ? JSON.parse(slide.bullets) : [];

  return (
    <div className="w-full h-full flex flex-col gap-4 overflow-auto">
      {/* Generated Image */}
      {slide.imageUrl ? (
        <div className="w-full rounded-lg overflow-hidden border border-border shadow-md flex-shrink-0">
          <img
            src={slide.imageUrl}
            alt={slide.title}
            className="w-full h-auto object-contain"
            style={{ aspectRatio: '16 / 9' }}
          />
        </div>
      ) : (
        <div
          className="w-full rounded-lg border border-dashed border-border flex items-center justify-center bg-muted/50 flex-shrink-0"
          style={{ aspectRatio: '16 / 9' }}
        >
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <ImageIcon className="h-8 w-8" />
            <p className="text-sm">Image not generated yet</p>
          </div>
        </div>
      )}

      {/* Slide content card */}
      <div className="bg-card border border-border rounded-lg p-6 flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
          <span>Slide {slide.order + 1}</span>
          {theme && <span className="capitalize">• {theme}</span>}
        </div>

        <h2 className="text-xl font-bold mb-2">{slide.title}</h2>
        {slide.subtitle && (
          <p className="text-muted-foreground mb-4">{slide.subtitle}</p>
        )}

        {bullets.length > 0 && (
          <ul className="space-y-2">
            {bullets.map((point: string, idx: number) => (
              <li key={idx} className="text-sm flex items-start gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        )}

        {slide.notes && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
            <p className="text-sm text-muted-foreground">{slide.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
