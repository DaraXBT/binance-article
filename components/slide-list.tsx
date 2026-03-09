'use client';

import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  GripVertical,
  ImageIcon,
  Loader2,
  Plus,
} from 'lucide-react';

import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { buildArticleSlideAssetUrl } from '@/lib/article-assets';
import { DeckSlide } from '@/lib/schemas';

interface SlideListProps {
  articleId: string;
  slides: DeckSlide[];
  activeSlideId: string | null;
  onSelectSlide: (slideId: string) => void;
  onAddSlide?: () => void;
  onMoveUp?: (slideId: string) => void;
  onMoveDown?: (slideId: string) => void;
  isReordering?: boolean;
}

export function SlideList({
  articleId,
  slides,
  activeSlideId,
  onSelectSlide,
  onAddSlide,
  onMoveUp,
  onMoveDown,
  isReordering = false,
}: SlideListProps) {
  const { messages } = useLanguage();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h3 className="font-semibold">{messages.slideList.slides(slides.length)}</h3>
        {onAddSlide ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onAddSlide}
            className="gap-2"
            disabled={isReordering}
          >
            <Plus className="h-4 w-4" />
            {messages.common.add}
          </Button>
        ) : null}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {slides.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {messages.slideList.noSlidesYet}
          </p>
        ) : (
          slides.map((slide, index) => {
            const isActive = activeSlideId === slide.id;
            const imageUrl = slide.imageUrl
              ? buildArticleSlideAssetUrl(articleId, slide.imageUrl)
              : null;

            return (
              <div
                key={slide.id}
                className={`overflow-hidden border transition-all ${
                  isActive
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectSlide(slide.id)}
                  className="block w-full text-left"
                >
                  {imageUrl ? (
                    <div className="h-16 w-full overflow-hidden bg-muted">
                      <img
                        src={imageUrl}
                        alt={slide.title}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="flex h-10 w-full items-center justify-center bg-muted/50">
                      {slide.imageStatus === 'failed' ? (
                        <AlertCircle className="h-3.5 w-3.5 text-destructive/70" />
                      ) : slide.imageStatus === 'pending' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/70" />
                      ) : (
                        <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/50" />
                      )}
                    </div>
                  )}

                  <div className="p-2.5">
                    <div className="flex items-start gap-2">
                      <GripVertical className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{slide.title}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {messages.slideList.slide(slide.order + 1)}
                        </p>
                      </div>
                    </div>
                  </div>
                </button>

                {(onMoveUp || onMoveDown) ? (
                  <div className="flex items-center justify-end gap-1 border-t border-border/60 bg-background/60 px-2 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onMoveUp?.(slide.id)}
                      disabled={index === 0 || isReordering}
                      aria-label={messages.slideList.moveUp}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onMoveDown?.(slide.id)}
                      disabled={index === slides.length - 1 || isReordering}
                      aria-label={messages.slideList.moveDown}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
