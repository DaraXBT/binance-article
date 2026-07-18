'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, MoveDiagonal, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { buildArticleSlideAssetUrl } from '@/lib/article-assets';
import {
  BINANCE_COVER_HEIGHT,
  BINANCE_COVER_WIDTH,
  BinanceExportSlide,
  assembleBinanceArticle,
  calculateCoverCrop,
  createBinanceBundle,
  getBinanceExportIssues,
  getSlideImagePath,
  normalizeBinanceTags,
  sniffImageMimeType,
} from '@/lib/binance-export';
import type { DeckDetailResponse, DeckSlide } from '@/lib/schemas';

type BinanceExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deck: DeckDetailResponse;
};

type FocalPoint = { x: number; y: number };

function inferImageMimeType(url: string | null): 'image/jpeg' | 'image/png' | 'image/webp' {
  const pathname = url?.split('?')[0]?.toLowerCase() ?? '';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

function toExportSlide(slide: DeckSlide, index: number): BinanceExportSlide {
  const mimeType = inferImageMimeType(slide.imageUrl);
  return {
    id: slide.id,
    title: slide.title,
    subtitle: slide.subtitle,
    bullets: slide.bullets ?? slide.bulletPoints ?? [],
    notes: slide.notes,
    imagePath: slide.imageUrl ? getSlideImagePath(index, mimeType) : null,
  };
}

function initialMarkdown(deck: DeckDetailResponse): string {
  return assembleBinanceArticle({
    intro: deck.captions?.blogIntro,
    sections: deck.captions?.blogSections,
    tags: deck.captions?.blogTags,
    slides: deck.slides.map(toExportSlide),
  }).markdown;
}

function safeDownloadName(value: string): string {
  const safe = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${safe || 'article'}-binance-square.zip`;
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
  return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
}

async function cropCoverToJpeg(blob: Blob, focal: FocalPoint): Promise<Blob> {
  const image = await loadImage(blob);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const crop = calculateCoverCrop(width, height, focal.x, focal.y);
  const canvas = document.createElement('canvas');
  canvas.width = BINANCE_COVER_WIDTH;
  canvas.height = BINANCE_COVER_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser cannot create a cover preview.');
  context.drawImage(
    image,
    crop.sourceX,
    crop.sourceY,
    crop.sourceWidth,
    crop.sourceHeight,
    0,
    0,
    BINANCE_COVER_WIDTH,
    BINANCE_COVER_HEIGHT,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('The cover crop could not be encoded as JPEG.'));
    }, 'image/jpeg', 0.92);
  });
}

function replaceImagePath(markdown: string, oldPath: string, newPath: string): string {
  return markdown.split(oldPath).join(newPath);
}

function getPreviewAssetUrl(articleId: string, storedImageUrl: string | null): string | null {
  if (!storedImageUrl) return null;
  try {
    return buildArticleSlideAssetUrl(articleId, storedImageUrl);
  } catch {
    return null;
  }
}

export function BinanceExportDialog({ open, onOpenChange, deck }: BinanceExportDialogProps) {
  const generatedSlides = useMemo(
    () => deck.slides.filter((slide) => Boolean(slide.imageUrl) && slide.imageStatus === 'generated'),
    [deck.slides],
  );
  const firstCoverId = generatedSlides[0]?.id ?? null;
  const [title, setTitle] = useState(deck.captions?.blogTitle?.trim() || deck.title);
  const [markdown, setMarkdown] = useState(() => initialMarkdown(deck));
  const [coverSlideId, setCoverSlideId] = useState<string | null>(firstCoverId);
  const [focal, setFocal] = useState<FocalPoint>({ x: 0.5, y: 0.5 });
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(deck.captions?.blogTitle?.trim() || deck.title);
    setMarkdown(initialMarkdown(deck));
    setCoverSlideId(firstCoverId);
    setFocal({ x: 0.5, y: 0.5 });
    setDownloaded(false);
    setDownloadError(null);
  }, [deck, firstCoverId]);

  const issues = useMemo(() => getBinanceExportIssues({
    title,
    markdown,
    coverSlideId,
    slides: deck.slides,
  }), [coverSlideId, deck.slides, markdown, title]);
  const coverSlide = deck.slides.find((slide) => slide.id === coverSlideId) ?? null;
  const coverPreviewUrl = getPreviewAssetUrl(deck.id, coverSlide?.imageUrl ?? null);
  const normalizedTags = normalizeBinanceTags(deck.captions?.blogTags);
  const blocking = issues.errors.length > 0 || isDownloading;

  const handleDownload = async () => {
    if (issues.errors.length > 0 || !coverSlide?.imageUrl) return;
    setIsDownloading(true);
    setDownloaded(false);
    setDownloadError(null);

    try {
      const imageInputs: Array<{
        slideId: string;
        order: number;
        path: string;
        bytes: Blob;
        mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
        width: number;
        height: number;
      }> = [];
      let exportMarkdown = markdown;

      for (const [order, slide] of deck.slides.entries()) {
        if (!slide.imageUrl || slide.imageStatus !== 'generated') continue;
        const blob = await readBlob(buildArticleSlideAssetUrl(deck.id, slide.imageUrl));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const mimeType = sniffImageMimeType(bytes);
        const path = getSlideImagePath(order, mimeType);
        const originalPath = getSlideImagePath(order, inferImageMimeType(slide.imageUrl));
        if (originalPath !== path) exportMarkdown = replaceImagePath(exportMarkdown, originalPath, path);
        const dimensions = await getImageDimensions(blob);
        imageInputs.push({ slideId: slide.id, order, path, bytes: blob, mimeType, ...dimensions });
      }

      const coverBlob = await readBlob(buildArticleSlideAssetUrl(deck.id, coverSlide.imageUrl));
      const cover = await cropCoverToJpeg(coverBlob, focal);
      const bundle = await createBinanceBundle({
        articleId: deck.id,
        title,
        markdown: exportMarkdown,
        cover: {
          sourceSlideId: coverSlide.id,
          bytes: cover,
          mimeType: 'image/jpeg',
          width: BINANCE_COVER_WIDTH,
          height: BINANCE_COVER_HEIGHT,
        },
        images: imageInputs,
      });
      const url = URL.createObjectURL(new Blob([bundle.bytes], { type: 'application/zip' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = safeDownloadName(title);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setDownloaded(true);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Could not create the Binance bundle.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export to Binance Square</DialogTitle>
          <DialogDescription>
            Edit the draft, choose a 5:2 cover, then download a reviewable bundle for the local publishing skill.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="binance-article-title">Article title</label>
              <Input
                id="binance-article-title"
                aria-label="Article title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
              />
              <p className="text-xs text-muted-foreground">{title.length}/200 characters</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="binance-article-markdown">Article Markdown</label>
              <Textarea
                id="binance-article-markdown"
                aria-label="Article Markdown"
                value={markdown}
                onChange={(event) => setMarkdown(event.target.value)}
                className="min-h-[28rem] font-mono text-xs"
                spellCheck={false}
              />
              <p className={`text-xs ${markdown.length > 100_000 ? 'text-destructive' : 'text-muted-foreground'}`}>
                {markdown.length.toLocaleString()}/100,000 characters
              </p>
            </div>

            {issues.errors.length > 0 ? (
              <div role="alert" className="space-y-1 border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {issues.errors.map((error) => <p key={error}>{error}</p>)}
              </div>
            ) : null}
            {issues.warnings.length > 0 ? (
              <div className="space-y-1 border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
                {issues.warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            ) : null}
            {downloadError ? <p role="alert" className="text-sm text-destructive">{downloadError}</p> : null}
            {downloaded ? (
              <div className="flex items-start gap-2 border border-primary/30 bg-primary/10 p-3 text-sm">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Bundle downloaded. Ask the local agent to prepare it, review Binance’s draft, and wait for your explicit confirmation before publishing.</p>
              </div>
            ) : null}
          </div>

          <aside className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MoveDiagonal className="h-4 w-4" />
                Cover image (5:2)
              </div>
              {coverPreviewUrl ? (
                <div className="overflow-hidden border bg-muted">
                  <img
                    src={coverPreviewUrl}
                    alt="Selected Binance cover preview"
                    className="aspect-[5/2] w-full object-cover"
                    style={{ objectPosition: `${focal.x * 100}% ${focal.y * 100}%` }}
                  />
                </div>
              ) : (
                <div className="flex aspect-[5/2] items-center justify-center border bg-muted text-xs text-muted-foreground">No generated cover available</div>
              )}
              <label className="block text-xs text-muted-foreground" htmlFor="binance-cover-x">Horizontal focus</label>
              <input
                id="binance-cover-x"
                aria-label="Cover horizontal focus"
                type="range"
                min="0"
                max="100"
                value={Math.round(focal.x * 100)}
                onChange={(event) => setFocal((current) => ({ ...current, x: Number(event.target.value) / 100 }))}
                className="w-full"
              />
              <label className="block text-xs text-muted-foreground" htmlFor="binance-cover-y">Vertical focus</label>
              <input
                id="binance-cover-y"
                aria-label="Cover vertical focus"
                type="range"
                min="0"
                max="100"
                value={Math.round(focal.y * 100)}
                onChange={(event) => setFocal((current) => ({ ...current, y: Number(event.target.value) / 100 }))}
                className="w-full"
              />
              <div className="space-y-2 pt-2">
                {deck.slides.map((slide, index) => {
                  const available = Boolean(slide.imageUrl) && slide.imageStatus === 'generated';
                  return (
                    <label key={slide.id} className={`flex items-center gap-2 text-sm ${available ? '' : 'text-muted-foreground'}`}>
                      <input
                        type="radio"
                        name="binance-cover-slide"
                        aria-label={`Use ${slide.title} as cover`}
                        checked={coverSlideId === slide.id}
                        disabled={!available}
                        onChange={() => setCoverSlideId(slide.id)}
                      />
                      <span>{index + 1}. {slide.title}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1 rounded border p-3 text-xs text-muted-foreground">
              <p>{deck.slides.length} slides · {generatedSlides.length} images included</p>
              <p>{normalizedTags.length} normalized hashtags</p>
              <p>ZIP contains no login cookies, workspace keys, or server credentials.</p>
            </div>
          </aside>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={handleDownload} disabled={blocking}>
            {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isDownloading ? 'Creating bundle...' : 'Download Binance bundle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
