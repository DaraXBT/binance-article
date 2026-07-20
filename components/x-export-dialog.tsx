'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, ImageIcon, Loader2, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { buildArticleSlideAssetUrl } from '@/lib/article-assets';
import { sniffImageMimeType } from '@/lib/binance-export';
import type { DeckDetailResponse, DeckSlide } from '@/lib/schemas';
import {
  X_POST_MAX_CHARACTERS,
  X_POST_MAX_IMAGES,
  X_POST_STANDARD_CHARACTERS,
  createXPostBundle,
  getXPostExportIssues,
  getXPostImagePath,
} from '@/lib/x-export';

type XExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deck: DeckDetailResponse;
};

function generatedImageSlides(slides: readonly DeckSlide[]): DeckSlide[] {
  return slides.filter((slide) => Boolean(slide.imageUrl) && slide.imageStatus === 'generated');
}

function generatedPosts(deck: DeckDetailResponse): string[] {
  return [deck.captions?.xSingle1, deck.captions?.xSingle2, deck.captions?.xSingle3]
    .filter((post): post is string => Boolean(post?.trim()))
    .map((post) => post.trim());
}

function safeDownloadName(value: string): string {
  const safe = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${safe || 'article'}-x-post.zip`;
}

async function readBlob(url: string): Promise<Blob> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Asset request failed (${response.status}).`);
  const blob = await response.blob();
  if (!blob.size) throw new Error('Asset response was empty.');
  return blob;
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The downloaded image could not be decoded.'));
    };
    image.src = url;
  });
}

async function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const image = await loadImage(blob);
  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  };
}

export function XExportDialog({ open, onOpenChange, deck }: XExportDialogProps) {
  const posts = useMemo(() => generatedPosts(deck), [deck]);
  const availableSlides = useMemo(() => generatedImageSlides(deck.slides), [deck.slides]);
  const defaultImageIds = useMemo(
    () => availableSlides.slice(0, X_POST_MAX_IMAGES).map((slide) => slide.id),
    [availableSlides],
  );
  const [text, setText] = useState(posts[0] ?? '');
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>(defaultImageIds);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    setText(posts[0] ?? '');
    setSelectedImageIds(defaultImageIds);
    setIsDownloading(false);
    setDownloaded(false);
    setDownloadError(null);
  }, [deck.id, defaultImageIds, posts]);

  const issues = useMemo(() => getXPostExportIssues({
    text,
    selectedImageCount: selectedImageIds.length,
  }), [selectedImageIds.length, text]);
  const characterCount = [...text.trim()].length;
  const blocking = isDownloading || issues.errors.length > 0;

  const toggleImage = (slideId: string) => {
    setDownloaded(false);
    setDownloadError(null);
    setSelectedImageIds((current) => {
      if (current.includes(slideId)) return current.filter((id) => id !== slideId);
      if (current.length >= X_POST_MAX_IMAGES) return current;
      return [...current, slideId];
    });
  };

  const handleDownload = async () => {
    if (blocking) return;
    setIsDownloading(true);
    setDownloaded(false);
    setDownloadError(null);

    try {
      const selectedSlides = selectedImageIds
        .map((slideId) => availableSlides.find((slide) => slide.id === slideId))
        .filter((slide): slide is DeckSlide => Boolean(slide?.imageUrl))
        .sort((left, right) => left.order - right.order);
      const images = [] as Array<{
        slideId: string;
        order: number;
        path: string;
        bytes: Blob;
        mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
        width: number;
        height: number;
      }>;

      for (const [order, slide] of selectedSlides.entries()) {
        const blob = await readBlob(buildArticleSlideAssetUrl(deck.id, slide.imageUrl!));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const mimeType = sniffImageMimeType(bytes);
        const dimensions = await getImageDimensions(blob);
        images.push({
          slideId: slide.id,
          order,
          path: getXPostImagePath(order, mimeType),
          bytes: blob,
          mimeType,
          ...dimensions,
        });
      }

      const bundle = await createXPostBundle({
        articleId: deck.id,
        text,
        images,
      });
      const url = URL.createObjectURL(new Blob([bundle.bytes], { type: 'application/zip' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = safeDownloadName(deck.title);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setDownloaded(true);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Could not create the X post bundle.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prepare X post</DialogTitle>
          <DialogDescription>
            Choose a generated post and up to four images. The local X skill opens a review draft in Chrome and never posts automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0 space-y-3">
            {posts.length > 0 ? (
              <div className="flex flex-wrap gap-1.5" aria-label="Generated X posts">
                {posts.map((post, index) => (
                  <Button
                    key={`${index}-${post.slice(0, 24)}`}
                    type="button"
                    size="sm"
                    variant={text === post ? 'default' : 'outline'}
                    className="h-8 rounded-none border-dotted text-xs"
                    onClick={() => {
                      setText(post);
                      setDownloaded(false);
                      setDownloadError(null);
                    }}
                    aria-label={`Use post ${index + 1}`}
                  >
                    Post {index + 1}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="border border-dotted border-border px-3 py-2 text-xs text-muted-foreground">
                No generated X caption is available yet. Write the post below.
              </p>
            )}

            <div className="space-y-2">
              <label htmlFor="x-post-text" className="text-sm font-medium">X post text</label>
              <Textarea
                id="x-post-text"
                aria-label="X post text"
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setDownloaded(false);
                  setDownloadError(null);
                }}
                maxLength={X_POST_MAX_CHARACTERS}
                className="min-h-48 resize-y font-sans text-sm leading-relaxed"
              />
              <p className={characterCount > X_POST_STANDARD_CHARACTERS
                ? 'text-xs text-[var(--access-signal)]'
                : 'text-xs text-muted-foreground'}>
                {characterCount.toLocaleString()} characters · 280 standard
              </p>
            </div>

            {issues.errors.length > 0 ? (
              <div role="alert" className="space-y-1 border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {issues.errors.map((error) => <p key={error}>{error}</p>)}
              </div>
            ) : null}
            {issues.warnings.length > 0 ? (
              <div className="space-y-1 border border-[var(--access-signal)]/35 bg-[var(--access-signal)]/5 p-3 text-sm">
                {issues.warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            ) : null}
            {downloadError ? <p role="alert" className="text-sm text-destructive">{downloadError}</p> : null}
            {downloaded ? (
              <div className="flex items-start gap-2 border border-primary/30 bg-primary/5 p-3 text-sm">
                <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                <p>Bundle downloaded. Ask the local agent to prepare it with the X posting skill, then review the live X composer and post manually.</p>
              </div>
            ) : null}
          </div>

          <aside className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <ImageIcon aria-hidden="true" className="size-4" />
                Post images
              </p>
              <span className="font-mono text-[0.65rem] text-muted-foreground">
                {selectedImageIds.length}/{X_POST_MAX_IMAGES}
              </span>
            </div>
            {availableSlides.length > 0 ? (
              <div className="space-y-1.5">
                {availableSlides.map((slide, index) => {
                  const selected = selectedImageIds.includes(slide.id);
                  const selectionFull = selectedImageIds.length >= X_POST_MAX_IMAGES;
                  return (
                    <label
                      key={slide.id}
                      className="flex min-w-0 items-start gap-2 border border-dotted border-border/75 px-2.5 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        aria-label={`Use ${slide.title} image`}
                        checked={selected}
                        disabled={!selected && selectionFull}
                        onChange={() => toggleImage(slide.id)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 truncate">{index + 1}. {slide.title}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="border border-dotted border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                No generated slide images are available. A text-only post is supported.
              </p>
            )}
            <div className="border-t border-dotted border-border pt-3 text-xs leading-relaxed text-muted-foreground">
              The ZIP contains only the selected post and verified image files—never login cookies, access codes, or workspace keys.
            </div>
          </aside>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" className="rounded-none" onClick={handleDownload} disabled={blocking}>
            {isDownloading ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Download aria-hidden="true" className="size-4" />}
            {isDownloading ? 'Creating bundle…' : 'Download X post bundle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
