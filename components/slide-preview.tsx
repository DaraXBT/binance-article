'use client';

import { AlertCircle, ImageIcon, Loader2, Download, Expand } from 'lucide-react';

import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { buildArticleSlideAssetUrl } from '@/lib/article-assets';
import { DeckSlide } from '@/lib/schemas';

interface SlidePreviewProps {
  articleId: string;
  slide: DeckSlide | null;
  theme?: string;
}

export function SlidePreview({ articleId, slide, theme = 'default' }: SlidePreviewProps) {
  const { messages } = useLanguage();

  if (!slide) {
    return (
      <div className="h-full flex items-center justify-center bg-muted border border-border ">
        <p className="text-muted-foreground">{messages.slidePreview.selectSlide}</p>
      </div>
    );
  }

  const bullets = slide.bulletPoints;
  const imageStatus = slide.imageStatus;
  const imageUrl = slide.imageUrl ? buildArticleSlideAssetUrl(articleId, slide.imageUrl) : null;
  const downloadUrl = slide.imageUrl
    ? buildArticleSlideAssetUrl(articleId, slide.imageUrl, { download: true })
    : null;
  const imageMessage =
    imageStatus === 'failed'
      ? messages.slidePreview.imageFailed
      : imageStatus === 'pending'
        ? messages.slidePreview.imagePending
        : messages.slidePreview.imageNotGenerated;

  return (
    <div className="w-full h-full flex flex-col gap-4 overflow-auto">
      {/* Generated Image */}
      {imageUrl ? (
        <Dialog>
          <div className="w-full relative overflow-hidden border border-border shadow-md flex-shrink-0 group">
            <DialogTrigger asChild>
              <button type="button" className="w-full cursor-pointer">
                <img
                  src={imageUrl}
                  alt={slide.title}
                  className="w-full h-auto object-contain"
                  style={{ aspectRatio: '16 / 9' }}
                />
              </button>
            </DialogTrigger>
            {/* Overlay buttons */}
            <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <DialogTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-2 bg-background/80 hover:bg-background/95 backdrop-blur-sm shadow-sm pointer-events-auto"
                >
                  <Expand className="w-4 h-4" />
                  {messages.slidePreview.viewFullImage}
                </Button>
              </DialogTrigger>
              <Button
                variant="secondary"
                size="sm"
                asChild
                className="gap-2 bg-background/80 hover:bg-background/95 backdrop-blur-sm shadow-sm pointer-events-auto"
              >
                <a
                  href={downloadUrl ?? undefined}
                  download={`slide-${slide.order + 1}-${slide.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Download className="w-4 h-4" />
                  Download
                </a>
              </Button>
            </div>
          </div>
          <DialogContent className="max-w-[95vw] max-h-[95vh] w-auto border-none bg-black/90 p-0 sm:max-w-[95vw]">
            <DialogTitle className="sr-only">{slide.title}</DialogTitle>
            <img
              src={imageUrl}
              alt={slide.title}
              className="max-w-[95vw] max-h-[95vh] object-contain"
            />
          </DialogContent>
        </Dialog>
      ) : (
        <div
          className="w-full  border border-dashed border-border flex items-center justify-center bg-muted/50 flex-shrink-0"
          style={{ aspectRatio: '16 / 9' }}
        >
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            {imageStatus === 'failed' ? (
              <AlertCircle className="h-8 w-8 text-destructive" />
            ) : imageStatus === 'pending' ? (
              <Loader2 className="h-8 w-8 animate-spin" />
            ) : (
              <ImageIcon className="h-8 w-8" />
            )}
            <p className="text-sm">{imageMessage}</p>
            {imageStatus === 'failed' && slide.imageError ? (
              <p className="max-w-md text-center text-xs text-destructive/80">
                {messages.slidePreview.imageFailureReason}: {slide.imageError}
              </p>
            ) : null}
          </div>
        </div>
      )}

      {/* Slide content card */}
      <div className="bg-card border border-border  p-6 flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
          <span>{messages.slidePreview.slide(slide.order + 1)}</span>
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
                <span className="inline-block w-1.5 h-1.5  bg-primary mt-2 flex-shrink-0" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        )}

        {slide.notes && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs font-medium text-muted-foreground mb-1">
              {messages.slidePreview.notes}
            </p>
            <p className="text-sm text-muted-foreground">{slide.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
