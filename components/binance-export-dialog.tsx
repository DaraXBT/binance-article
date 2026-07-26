'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, MoveDiagonal, ShieldCheck } from 'lucide-react';

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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { buildArticleSlideAssetUrl, parseArticleAssetReference } from '@/lib/article-assets';
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
import type { PublishingMessages } from '@/lib/publishing-i18n';
import type { DeckDetailResponse, DeckSlide } from '@/lib/schemas';

type BinanceExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deck: DeckDetailResponse;
};

type FocalPoint = { x: number; y: number };
type BinanceCopy = PublishingMessages['binance'];

class LocalizedExportError extends Error {}

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

async function readBlob(url: string, copy: BinanceCopy): Promise<Blob> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new LocalizedExportError(copy.assetRequestFailed(response.status));
  const blob = await response.blob();
  if (!blob.size) throw new LocalizedExportError(copy.assetEmpty);
  return blob;
}

function loadImage(blob: Blob, copy: BinanceCopy): Promise<HTMLImageElement> {
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
  copy: BinanceCopy,
): Promise<{ width: number; height: number }> {
  const image = await loadImage(blob, copy);
  return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
}

async function cropCoverToJpeg(blob: Blob, focal: FocalPoint, copy: BinanceCopy): Promise<Blob> {
  const image = await loadImage(blob, copy);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const crop = calculateCoverCrop(width, height, focal.x, focal.y);
  const canvas = document.createElement('canvas');
  canvas.width = BINANCE_COVER_WIDTH;
  canvas.height = BINANCE_COVER_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new LocalizedExportError(copy.previewUnavailable);
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
      else reject(new LocalizedExportError(copy.cropFailed));
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

function canonicalPublicationBody(deck: DeckDetailResponse, markdown: string) {
  let canonicalMarkdown = markdown;
  const orderedAssetIds: string[] = [];
  for (const [index, slide] of deck.slides.entries()) {
    if (!slide.imageUrl || slide.imageStatus !== 'generated') continue;
    let assetId: string;
    try {
      assetId = parseArticleAssetReference(slide.imageUrl).assetId;
    } catch {
      continue;
    }
    const imagePath = getSlideImagePath(index, inferImageMimeType(slide.imageUrl));
    const canonicalReference = `asset:${assetId}`;
    if (canonicalMarkdown.includes(`](${imagePath})`)) {
      canonicalMarkdown = canonicalMarkdown.replace(`](${imagePath})`, `](${canonicalReference})`);
      orderedAssetIds.push(assetId);
    }
  }
  return { markdown: canonicalMarkdown, orderedAssetIds };
}

export function BinanceExportDialog({ open, onOpenChange, deck }: BinanceExportDialogProps) {
  const { messages } = useLanguage();
  const copy = messages.publishing.binance;
  const publication = usePublicationCommand('binance-square', deck.id);
  const resetPublication = publication.reset;
  const generatedSlides = useMemo(
    () => deck.slides.filter((slide) => Boolean(slide.imageUrl) && slide.imageStatus === 'generated'),
    [deck.slides],
  );
  const [title, setTitle] = useState(deck.captions?.blogTitle?.trim() || deck.title);
  const [markdown, setMarkdown] = useState(() => initialMarkdown(deck));
  const [focal, setFocal] = useState<FocalPoint>({ x: 0.5, y: 0.5 });
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);
  const [isDraftLoading, setIsDraftLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // The article page polls while a job runs, replacing `deck` on every tick;
  // form state must only re-seed when the dialog (re)opens, never mid-edit.
  const deckRef = useRef(deck);
  deckRef.current = deck;

  useEffect(() => {
    if (!open) return;
    const currentDeck = deckRef.current;
    setTitle(currentDeck.captions?.blogTitle?.trim() || currentDeck.title);
    setMarkdown(initialMarkdown(currentDeck));
    setFocal({ x: 0.5, y: 0.5 });
    setDownloaded(false);
    setDownloadError(null);
    resetPublication();
  }, [open, deck.id, resetPublication]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsDraftLoading(true);
    setDraftLoadError(null);
    void fetch(`/api/articles/${encodeURIComponent(deck.id)}/publications/binance`, {
      cache: 'no-store',
    }).then((response) => readPublicationResponse(response, copy.draftLoadFailed))
      .then(({ draft }) => {
        if (cancelled) return;
        setDraftRevision(draft?.revision ?? 0);
        if (draft) {
          setTitle(draft.title);
          setMarkdown(draft.markdown);
          setFocal({ x: draft.cover.focalX, y: draft.cover.focalY });
        }
      })
      .catch(() => {
        // Without the saved revision a save would race the server draft;
        // surface the failure and keep Prepare disabled until a retry works.
        if (cancelled) return;
        setDraftRevision(null);
        setDraftLoadError(copy.draftLoadFailed);
      })
      .finally(() => {
        if (!cancelled) setIsDraftLoading(false);
      });
    return () => { cancelled = true; };
  }, [copy.draftLoadFailed, deck.id, open, reloadToken]);

  const dedicatedCoverReady = deck.cover?.status === 'generated' && Boolean(deck.cover.imageUrl);

  const issues = useMemo(() => getBinanceExportIssues({
    title,
    markdown,
    // The dedicated cover is its own record, never a slide id.
    hasDedicatedCover: dedicatedCoverReady,
    slides: deck.slides.map((slide, index) => ({
      ...slide,
      imagePath: slide.imageUrl ? getSlideImagePath(index, inferImageMimeType(slide.imageUrl)) : null,
    })),
  }, copy), [copy, dedicatedCoverReady, deck.slides, markdown, title]);
  const contentWarnings = useMemo(() => assembleBinanceArticle({
    intro: deck.captions?.blogIntro,
    sections: deck.captions?.blogSections,
    tags: deck.captions?.blogTags,
    slides: deck.slides.map(toExportSlide),
  }, copy).warnings, [copy, deck.captions, deck.slides]);
  const warnings = [...new Set([...contentWarnings, ...issues.warnings])];
  const coverPreviewUrl = getPreviewAssetUrl(deck.id, deck.cover?.imageUrl ?? null);
  const normalizedTags = normalizeBinanceTags(deck.captions?.blogTags);
  const blocking = issues.errors.length > 0 || isDownloading;
  const commandActive = publication.command && ![
    'succeeded', 'failed', 'cancelled', 'expired', 'outcome_unknown',
  ].includes(publication.command.state);

  const handlePrepare = async () => {
    if (issues.errors.length > 0 || isDraftLoading || draftRevision === null || commandActive) return;
    const publicationBody = canonicalPublicationBody(deck, markdown);
    await publication.prepare(async () => {
      const savedResponse = await fetch(`/api/articles/${encodeURIComponent(deck.id)}/publications/binance`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: draftRevision,
          title,
          markdown: publicationBody.markdown,
          cover: { focalX: focal.x, focalY: focal.y },
          orderedAssetIds: publicationBody.orderedAssetIds,
        }),
      });
      const saved = await readPublicationResponse(savedResponse, copy.draftSaveFailed);
      setDraftRevision(saved.draft.revision);
      const preparedResponse = await fetch(`/api/articles/${encodeURIComponent(deck.id)}/publications/binance/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: saved.draft.revision }),
      });
      return readPublicationResponse(preparedResponse, copy.prepareFailed);
    });
  };

  const handleDownload = async () => {
    if (issues.errors.length > 0 || !deck.cover?.imageUrl) return;
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
        const blob = await readBlob(buildArticleSlideAssetUrl(deck.id, slide.imageUrl), copy);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const mimeType = sniffImageMimeType(bytes);
        const path = getSlideImagePath(order, mimeType);
        const originalPath = getSlideImagePath(order, inferImageMimeType(slide.imageUrl));
        if (originalPath !== path) exportMarkdown = replaceImagePath(exportMarkdown, originalPath, path);
        const dimensions = await getImageDimensions(blob, copy);
        imageInputs.push({ slideId: slide.id, order, path, bytes: blob, mimeType, ...dimensions });
      }

      const coverBlob = await readBlob(buildArticleSlideAssetUrl(deck.id, deck.cover.imageUrl), copy);
      const cover = await cropCoverToJpeg(coverBlob, focal, copy);
      const bundle = await createBinanceBundle({
        articleId: deck.id,
        title,
        markdown: exportMarkdown,
        cover: {
          sourceSlideId: deck.cover.id,
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
      setDownloadError(error instanceof LocalizedExportError ? error.message : copy.bundleFailed);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-5xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{copy.dialogTitle}</DialogTitle>
          <DialogDescription>
            {copy.dialogDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="binance-article-title">{copy.articleTitle}</label>
              <Input
                id="binance-article-title"
                aria-label={copy.articleTitle}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
              />
              <p className="text-xs text-muted-foreground">{copy.characters(title.length, 200)}</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="binance-article-markdown">{copy.articleMarkdown}</label>
              <Textarea
                id="binance-article-markdown"
                aria-label={copy.articleMarkdown}
                value={markdown}
                onChange={(event) => setMarkdown(event.target.value)}
                className="min-h-64 font-mono text-xs sm:min-h-[28rem]"
                spellCheck={false}
              />
              <p className={`text-xs ${markdown.length > 100_000 ? 'text-destructive' : 'text-muted-foreground'}`}>
                {copy.characters(markdown.length, 100_000)}
              </p>
            </div>

            {issues.errors.length > 0 ? (
              <div role="alert" className="space-y-1 border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {issues.errors.map((error) => <p key={error}>{error}</p>)}
              </div>
            ) : null}
            {warnings.length > 0 ? (
              <div className="space-y-1 border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
                {warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            ) : null}
            {downloadError ? <p role="alert" className="text-sm text-destructive">{downloadError}</p> : null}
            {draftLoadError ? (
              <div role="alert" className="flex items-center justify-between gap-3 border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <p>{draftLoadError}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg text-xs"
                  onClick={() => setReloadToken((token) => token + 1)}
                >
                  {messages.common.retry}
                </Button>
              </div>
            ) : null}
            {downloaded ? (
              <div className="flex items-start gap-2 border border-primary/30 bg-primary/10 p-3 text-sm">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
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

          <aside className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MoveDiagonal className="h-4 w-4" />
                {copy.coverTitle}
              </div>
              {coverPreviewUrl ? (
                <div className="overflow-hidden border bg-muted">
                  <img
                    src={coverPreviewUrl}
                    alt={copy.coverPreviewAlt}
                    className="aspect-[5/2] w-full object-cover"
                    style={{ objectPosition: `${focal.x * 100}% ${focal.y * 100}%` }}
                  />
                </div>
              ) : (
                <div className="flex aspect-[5/2] items-center justify-center border bg-muted px-4 text-center text-xs text-muted-foreground">{copy.coverMissing}</div>
              )}
              <label className="block text-xs text-muted-foreground" htmlFor="binance-cover-x">{copy.horizontalFocus}</label>
              <input
                id="binance-cover-x"
                aria-label={copy.horizontalFocus}
                type="range"
                min="0"
                max="100"
                value={Math.round(focal.x * 100)}
                onChange={(event) => setFocal((current) => ({ ...current, x: Number(event.target.value) / 100 }))}
                className="w-full"
              />
              <label className="block text-xs text-muted-foreground" htmlFor="binance-cover-y">{copy.verticalFocus}</label>
              <input
                id="binance-cover-y"
                aria-label={copy.verticalFocus}
                type="range"
                min="0"
                max="100"
                value={Math.round(focal.y * 100)}
                onChange={(event) => setFocal((current) => ({ ...current, y: Number(event.target.value) / 100 }))}
                className="w-full"
              />
              <p className="pt-2 text-xs leading-relaxed text-muted-foreground">
                {copy.focusHint}
              </p>
            </div>

            <div className="space-y-1 rounded border p-3 text-xs text-muted-foreground">
              <p>{copy.assetSummary(deck.slides.length, generatedSlides.length)}</p>
              <p>{copy.tagSummary(normalizedTags.length)}</p>
              <p>{copy.fallbackSecurity}</p>
            </div>
          </aside>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{messages.common.cancel}</Button>
          <Button type="button" variant="outline" onClick={handleDownload} disabled={blocking}>
            {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isDownloading ? copy.creatingFallback : copy.downloadFallback}
          </Button>
          <Button
            type="button"
            onClick={() => void handlePrepare()}
            disabled={issues.errors.length > 0 || isDraftLoading || draftRevision === null || publication.isPreparing || Boolean(commandActive)}
          >
            {(isDraftLoading || publication.isPreparing) ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {publication.isPreparing ? copy.preparing : copy.prepare}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
