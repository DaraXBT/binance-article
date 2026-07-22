'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, ImageIcon, Loader2, ShieldCheck } from 'lucide-react';

import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import {
  PublicationCommandPanel,
  readPublicationResponse,
  usePublicationCommand,
} from '@/components/publication-command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { buildArticleSlideAssetUrl, parseArticleAssetReference } from '@/lib/article-assets';
import { sniffImageMimeType } from '@/lib/binance-export';
import type { PublishingMessages } from '@/lib/publishing-i18n';
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

type XCopy = PublishingMessages['x'];

class LocalizedExportError extends Error {}

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

async function readBlob(url: string, copy: XCopy): Promise<Blob> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new LocalizedExportError(copy.assetRequestFailed(response.status));
  const blob = await response.blob();
  if (!blob.size) throw new LocalizedExportError(copy.assetEmpty);
  return blob;
}

function loadImage(blob: Blob, copy: XCopy): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new LocalizedExportError(copy.decodeFailed));
    };
    image.src = url;
  });
}

async function getImageDimensions(
  blob: Blob,
  copy: XCopy,
): Promise<{ width: number; height: number }> {
  const image = await loadImage(blob, copy);
  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  };
}

export function XExportDialog({ open, onOpenChange, deck }: XExportDialogProps) {
  const { messages } = useLanguage();
  const copy = messages.publishing.x;
  const publication = usePublicationCommand('x', deck.id);
  const resetPublication = publication.reset;
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
  const [draftRevision, setDraftRevision] = useState(0);
  const [isDraftLoading, setIsDraftLoading] = useState(false);

  useEffect(() => {
    setText(posts[0] ?? '');
    setSelectedImageIds(defaultImageIds);
    setIsDownloading(false);
    setDownloaded(false);
    setDownloadError(null);
    resetPublication();
  }, [deck.id, defaultImageIds, posts, resetPublication]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsDraftLoading(true);
    void fetch(`/api/articles/${encodeURIComponent(deck.id)}/publications/x`, { cache: 'no-store' })
      .then((response) => readPublicationResponse(response, copy.draftLoadFailed))
      .then(({ draft }) => {
        if (cancelled) return;
        setDraftRevision(draft?.revision ?? 0);
        if (draft) {
          setText(draft.text);
          const selected = availableSlides.filter((slide) => {
            if (!slide.imageUrl) return false;
            try {
              return draft.orderedAssetIds.includes(parseArticleAssetReference(slide.imageUrl).assetId);
            } catch {
              return false;
            }
          }).map((slide) => slide.id);
          setSelectedImageIds(selected);
        }
      })
      .catch(() => {
        if (!cancelled) setDraftRevision(0);
      })
      .finally(() => {
        if (!cancelled) setIsDraftLoading(false);
      });
    return () => { cancelled = true; };
  }, [availableSlides, copy.draftLoadFailed, deck.id, open]);

  const issues = useMemo(() => getXPostExportIssues({
    text,
    selectedImageCount: selectedImageIds.length,
  }, copy), [copy, selectedImageIds.length, text]);
  const characterCount = [...text.trim()].length;
  const blocking = isDownloading || issues.errors.length > 0;
  const commandActive = publication.command && ![
    'succeeded', 'failed', 'cancelled', 'expired', 'outcome_unknown',
  ].includes(publication.command.state);

  const selectedAssetIds = () => selectedImageIds.flatMap((slideId) => {
    const slide = availableSlides.find((candidate) => candidate.id === slideId);
    if (!slide?.imageUrl) return [];
    try {
      return [parseArticleAssetReference(slide.imageUrl).assetId];
    } catch {
      return [];
    }
  });

  const handlePrepare = async () => {
    if (issues.errors.length > 0 || isDraftLoading || commandActive) return;
    await publication.prepare(async () => {
      const savedResponse = await fetch(`/api/articles/${encodeURIComponent(deck.id)}/publications/x`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: draftRevision,
          text,
          orderedAssetIds: selectedAssetIds(),
        }),
      });
      const saved = await readPublicationResponse(savedResponse, copy.draftSaveFailed);
      setDraftRevision(saved.draft.revision);
      const preparedResponse = await fetch(`/api/articles/${encodeURIComponent(deck.id)}/publications/x/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: saved.draft.revision }),
      });
      return readPublicationResponse(preparedResponse, copy.prepareFailed);
    });
  };

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
        const blob = await readBlob(buildArticleSlideAssetUrl(deck.id, slide.imageUrl!), copy);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const mimeType = sniffImageMimeType(bytes);
        const dimensions = await getImageDimensions(blob, copy);
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
      setDownloadError(error instanceof LocalizedExportError ? error.message : copy.bundleFailed);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{copy.dialogTitle}</DialogTitle>
          <DialogDescription>
            {copy.dialogDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0 space-y-3">
            {posts.length > 0 ? (
              <div className="flex flex-wrap gap-1.5" aria-label={copy.generatedPosts}>
                {posts.map((post, index) => (
                  <Button
                    key={`${index}-${post.slice(0, 24)}`}
                    type="button"
                    size="sm"
                    variant={text === post ? 'default' : 'outline'}
                    className="h-8 rounded-lg text-xs"
                    onClick={() => {
                      setText(post);
                      setDownloaded(false);
                      setDownloadError(null);
                    }}
                    aria-label={copy.usePost(index + 1)}
                  >
                    {copy.post(index + 1)}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="border border-dotted border-border px-3 py-2 text-xs text-muted-foreground">
                {copy.noGeneratedPost}
              </p>
            )}

            <div className="space-y-2">
              <label htmlFor="x-post-text" className="text-sm font-medium">{copy.textLabel}</label>
              <Textarea
                id="x-post-text"
                aria-label={copy.textLabel}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setDownloaded(false);
                  setDownloadError(null);
                }}
                maxLength={X_POST_MAX_CHARACTERS}
                className="min-h-48 resize-y font-sans text-sm leading-relaxed"
              />
              <p className="text-xs text-muted-foreground">
                {copy.characters(characterCount, X_POST_STANDARD_CHARACTERS)}
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
                <p>{copy.bundleReady}</p>
              </div>
            ) : null}
            <PublicationCommandPanel
              command={publication.command}
              error={publication.error}
              isApproving={publication.isApproving}
              isCancelling={publication.isCancelling}
              onApprove={() => void publication.approve()}
              onCancel={() => void publication.cancel()}
            />
          </div>

          <aside className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <ImageIcon aria-hidden="true" className="size-4" />
                {copy.imagesTitle}
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
                        aria-label={copy.useImage(slide.title)}
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
                {copy.noImages}
              </p>
            )}
            <div className="border-t border-dotted border-border pt-3 text-xs leading-relaxed text-muted-foreground">
              {copy.fallbackSecurity}
            </div>
          </aside>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-lg" onClick={() => onOpenChange(false)}>
            {messages.common.cancel}
          </Button>
          <Button type="button" variant="outline" className="rounded-lg" onClick={handleDownload} disabled={blocking}>
            {isDownloading ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Download aria-hidden="true" className="size-4" />}
            {isDownloading ? copy.creatingFallback : copy.downloadFallback}
          </Button>
          <Button
            type="button"
            className="rounded-lg"
            onClick={() => void handlePrepare()}
            disabled={issues.errors.length > 0 || isDraftLoading || publication.isPreparing || Boolean(commandActive)}
          >
            {(isDraftLoading || publication.isPreparing) ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            {publication.isPreparing ? copy.preparing : copy.prepare}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
