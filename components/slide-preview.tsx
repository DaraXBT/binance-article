'use client';

import { Slide } from '@prisma/client';

interface SlidePreviewProps {
  slide: Slide | null;
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

  // Calculate aspect ratio for 16:9 presentation
  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 rounded-lg overflow-hidden">
      <div
        className="w-full h-full bg-white shadow-2xl flex flex-col justify-between p-12"
        style={{
          aspectRatio: '16 / 9',
        }}
      >
        {/* Slide header */}
        <div>
          <h1 className="text-5xl font-bold text-slate-900 mb-4">{slide.title}</h1>
          {slide.subtitle && (
            <p className="text-2xl text-slate-600 mb-6">{slide.subtitle}</p>
          )}
        </div>

        {/* Slide content */}
        <div className="flex-1 flex flex-col justify-center">
          {(slide.bulletPoints as string[]).length > 0 && (
            <ul className="space-y-4">
              {(slide.bulletPoints as string[]).map((point, idx) => (
                <li key={idx} className="text-xl text-slate-700 flex items-start gap-3">
                  <span className="inline-block w-3 h-3 rounded-full bg-blue-600 mt-2 flex-shrink-0" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Slide footer */}
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Slide {slide.order + 1}</span>
          {theme && <span className="capitalize">{theme} Theme</span>}
        </div>
      </div>
    </div>
  );
}
