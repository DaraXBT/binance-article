'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ImageIcon, Loader2, MoveDiagonal, ShieldCheck } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import {
  PublicationCommandPanel,
  readPublicationResponse,
  usePublicationCommand,
  type PublicationKind,
  type PublicationTarget,
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
  BINANCE_ARTICLE_MAX_CHARACTERS,
  BINANCE_COVER_HEIGHT,
  BINANCE_COVER_WIDTH,
  BINANCE_TITLE_MAX_CHARACTERS,
  assembleBinanceArticle,
  calculateCoverCrop,
  createBinanceBundle,
  getSlideImagePath,
  sniffImageMimeType,
  type BinanceExportSlide,
} from '@/lib/binance-export';
import type { PublishingMessages } from '@/lib/publishing-i18n';
import type { DeckDetailResponse, DeckSlide } from '@/lib/schemas';
import {
  X_POST_MAX_CHARACTERS,
  X_POST_MAX_IMAGES,
  createXPostBundle,
  getXPostImagePath,
} from '@/lib/x-export';
import {
  BINANCE_POST_MAX_CHARACTERS,
  BINANCE_POST_MAX_IMAGES,
} from '@/server/domain/publication-recipe';

const ARTICLE_MAX_IMAGES = 10;

type Platform = 'binance' | 'x';
type FocalPoint = { x: number; y: number };
type DraftRevisions = Record<PublicationKind, number | null>;
type SelectedImages = Record<PublicationKind, string[]>;
type AssetCopy = Pick<
  PublishingMessages['x'],
  'assetRequestFailed' | 'assetEmpty' | 'decodeFailed'
>;
type CoverAssetCopy = AssetCopy & Pick<
  PublishingMessages['binance'],
  'previewUnavailable' | 'cropFailed'
>;

type PublicationExportDialogProps = {
  platform?: Platform;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deck: DeckDetailResponse;
};

class LocalizedExportError extends Error {}

function targetFor(platform: Platform): PublicationTarget {
  return platform === 'x' ? 'x' : 'binance-square';
}

function routeFor(platform: Platform): string {
  return platform === 'x' ? 'x' : 'binance';
}

function defaultKindFor(platform: Platform): PublicationKind {
  return platform === 'x' ? 'post' : 'article';
}

function generatedImageSlides(slides: readonly DeckSlide[]): DeckSlide[] {
  return slides.filter((slide) => Boolean(slide.imageUrl) && slide.imageStatus === 'generated');
}

function generatedPosts(deck: DeckDetailResponse): string[] {
  return [deck.captions?.xSingle1, deck.captions?.xSingle2, deck.captions?.xSingle3]
    .filter((post): post is string => Boolean(post?.trim()))
    .map((post) => post.trim());
}

function initialPostText(deck: DeckDetailResponse): string {
  return generatedPosts(deck)[0] ?? deck.captions?.blogIntro?.trim() ?? '';
}

function inferImageMimeType(url: string | null): 'image/jpeg' | 'image/png' | 'image/webp' {
  const pathname = url?.split('?')[0]?.toLowerCase() ?? '';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

function toExportSlide(slide: DeckSlide, index: number): BinanceExportSlide {
  return {
    id: slide.id,
    title: slide.title,
    subtitle: slide.subtitle,
    bullets: slide.bullets ?? slide.bulletPoints ?? [],
    notes: slide.notes,
    imagePath: slide.imageUrl && slide.imageStatus === 'generated'
      ? getSlideImagePath(index, inferImageMimeType(slide.imageUrl))
      : null,
  };
}

function initialArticleMarkdown(deck: DeckDetailResponse): string {
  return assembleBinanceArticle({
    intro: deck.captions?.blogIntro,
    sections: deck.captions?.blogSections,
    tags: deck.captions?.blogTags,
    slides: deck.slides.map(toExportSlide),
  }).markdown;
}

function assetIdForUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return parseArticleAssetReference(url).assetId;
  } catch {
    return null;
  }
}

function selectedSlideIdsFromAssets(
  deck: DeckDetailResponse,
  orderedAssetIds: readonly string[] | undefined,
): string[] {
  const selectedAssets = new Set(orderedAssetIds ?? []);
  return generatedImageSlides(deck.slides).flatMap((slide) => {
    const assetId = assetIdForUrl(slide.imageUrl);
    return assetId && selectedAssets.has(assetId) ? [slide.id] : [];
  });
}

function selectedAssetIds(deck: DeckDetailResponse, selectedSlideIds: readonly string[]): string[] {
  const selectedSlides = new Set(selectedSlideIds);
  return generatedImageSlides(deck.slides).flatMap((slide) => {
    if (!selectedSlides.has(slide.id)) return [];
    const assetId = assetIdForUrl(slide.imageUrl);
    return assetId ? [assetId] : [];
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeMarkdownImage(markdown: string, destination: string): string {
  return markdown.replace(
    new RegExp(`(?:^|\\n)[ \\t]*!\\[[^\\]]*\\]\\(${escapeRegExp(destination)}\\)[ \\t]*(?=\\n|$)`, 'gu'),
    '',
  );
}

function articleMarkdownForSelection(
  deck: DeckDetailResponse,
  markdown: string,
  selectedSlideIds: readonly string[],
  canonical: boolean,
): string {
  const selectedSlides = new Set(selectedSlideIds);
  let result = markdown;
  for (const [index, slide] of deck.slides.entries()) {
    const assetId = assetIdForUrl(slide.imageUrl);
    if (!assetId) continue;
    const localPath = getSlideImagePath(index, inferImageMimeType(slide.imageUrl));
    const canonicalPath = `asset:${assetId}`;
    if (!selectedSlides.has(slide.id)) {
      result = removeMarkdownImage(removeMarkdownImage(result, localPath), canonicalPath);
      continue;
    }
    result = canonical
      ? result.split(localPath).join(canonicalPath)
      : result.split(canonicalPath).join(localPath);
  }
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

function safeDownloadName(value: string, platform: Platform, kind: PublicationKind): string {
  const safe = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${safe || 'article'}-${platform}-${kind}.zip`;
}

async function readBlob(url: string, copy: AssetCopy): Promise<Blob> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new LocalizedExportError(copy.assetRequestFailed(response.status));
  const blob = await response.blob();
  if (!blob.size) throw new LocalizedExportError(copy.assetEmpty);
  return blob;
}

function loadImage(blob: Blob, copy: AssetCopy): Promise<HTMLImageElement> {
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

async function getImageDimensions(blob: Blob, copy: AssetCopy) {
  const image = await loadImage(blob, copy);
  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  };
}

async function cropCoverToJpeg(blob: Blob, focal: FocalPoint, copy: CoverAssetCopy): Promise<Blob> {
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

function downloadBytes(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function defaultSelectedImages(): SelectedImages {
  return {
    post: [],
    article: [],
  };
}

export function PublicationExportDialog({
  platform: fixedPlatform,
  open,
  onOpenChange,
  deck,
}: PublicationExportDialogProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>(fixedPlatform ?? 'binance');
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const platform = fixedPlatform ?? selectedPlatform;
  const { language, messages } = useLanguage();
  const xCopy = messages.publishing.x;
  const binanceCopy = messages.publishing.binance;
  const commandCopy = messages.publishing.command;
  const reviewCopy = messages.publishing.review;
  const copy = platform === 'x' ? xCopy : binanceCopy;
  const numberFormatter = useMemo(() => new Intl.NumberFormat(language), [language]);
  const target = targetFor(platform);
  const route = routeFor(platform);
  const defaultKind = defaultKindFor(platform);
  const posts = useMemo(() => generatedPosts(deck), [deck]);
  const availableSlides = useMemo(() => generatedImageSlides(deck.slides), [deck.slides]);
  const [kind, setKind] = useState<PublicationKind>(defaultKind);
  const publication = usePublicationCommand(target, deck.id, kind);
  const [postText, setPostText] = useState(() => initialPostText(deck));
  const [articleTitle, setArticleTitle] = useState(
    () => deck.captions?.blogTitle?.trim() || deck.title,
  );
  const [articleMarkdown, setArticleMarkdown] = useState(() => initialArticleMarkdown(deck));
  const [selectedImages, setSelectedImages] = useState<SelectedImages>(
    defaultSelectedImages,
  );
  const [includeCover, setIncludeCover] = useState(false);
  const [focal, setFocal] = useState<FocalPoint>({ x: 0.5, y: 0.5 });
  const [draftRevisions, setDraftRevisions] = useState<DraftRevisions>({
    post: null,
    article: null,
  });
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);
  const [isDraftLoading, setIsDraftLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const deckRef = useRef(deck);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    deckRef.current = deck;
  }, [deck]);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const currentDeck = deckRef.current;
      setKind(defaultKind);
      setPostText(initialPostText(currentDeck));
      setArticleTitle(currentDeck.captions?.blogTitle?.trim() || currentDeck.title);
      setArticleMarkdown(initialArticleMarkdown(currentDeck));
      setSelectedImages(defaultSelectedImages());
      setIncludeCover(false);
      setFocal({ x: 0.5, y: 0.5 });
      setDraftRevisions({ post: null, article: null });
      setDraftLoadError(null);
      setDownloaded(false);
      setDownloadError(null);
      setView('edit');
    }
    wasOpenRef.current = open;
  }, [defaultKind, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsDraftLoading(true);
    setDraftLoadError(null);
    void fetch(`/api/articles/${encodeURIComponent(deck.id)}/publications/${route}?kind=${kind}`, {
      cache: 'no-store',
    }).then((response) => readPublicationResponse(response, copy.draftLoadFailed))
      .then(({ draft }) => {
        if (cancelled) return;
        setDraftRevisions((current) => ({ ...current, [kind]: draft?.revision ?? 0 }));
        const currentDeck = deckRef.current;
        if (kind === 'post') {
          setPostText(draft ? draft.text : initialPostText(currentDeck));
          setSelectedImages((current) => ({
            ...current,
            post: draft
              ? selectedSlideIdsFromAssets(currentDeck, draft.orderedAssetIds)
              : defaultSelectedImages().post,
          }));
          return;
        }
        const selected = draft
          ? selectedSlideIdsFromAssets(currentDeck, draft.orderedAssetIds)
          : defaultSelectedImages().article;
        setArticleTitle(draft ? draft.title : currentDeck.captions?.blogTitle?.trim() || currentDeck.title);
        setArticleMarkdown(draft
          ? articleMarkdownForSelection(currentDeck, draft.markdown, selected, false)
          : initialArticleMarkdown(currentDeck));
        setSelectedImages((current) => ({ ...current, article: selected }));
        const coverAssetId = assetIdForUrl(currentDeck.cover?.imageUrl);
        setIncludeCover(draft
          ? Boolean(coverAssetId && draft.cover?.assetId === coverAssetId)
          : false);
        setFocal(draft?.cover
          ? { x: draft.cover.focalX, y: draft.cover.focalY }
          : { x: 0.5, y: 0.5 });
      })
      .catch(() => {
        if (cancelled) return;
        setDraftRevisions((current) => ({ ...current, [kind]: null }));
        setDraftLoadError(copy.draftLoadFailed);
      })
      .finally(() => {
        if (!cancelled) setIsDraftLoading(false);
      });
    return () => { cancelled = true; };
  }, [copy.draftLoadFailed, deck.id, kind, open, reloadToken, route]);

  const currentSelectedImages = selectedImages[kind];
  const previewSlides = useMemo(() => currentSelectedImages
    .map((slideId) => availableSlides.find((slide) => slide.id === slideId))
    .filter((slide): slide is DeckSlide => Boolean(slide?.imageUrl))
    .sort((left, right) => left.order - right.order), [availableSlides, currentSelectedImages]);
  const postMaxCharacters = platform === 'x'
    ? X_POST_MAX_CHARACTERS
    : BINANCE_POST_MAX_CHARACTERS;
  const postMaxImages = platform === 'x' ? X_POST_MAX_IMAGES : BINANCE_POST_MAX_IMAGES;
  const currentMaxImages = kind === 'post' ? postMaxImages : ARTICLE_MAX_IMAGES;
  const postCharacterCount = [...postText.trim()].length;
  const articleBodyForSelection = useMemo(() => articleMarkdownForSelection(
    deck,
    articleMarkdown,
    selectedImages.article,
    false,
  ), [articleMarkdown, deck, selectedImages.article]);
  const previewArticleMarkdown = articleBodyForSelection.replace(/!\[[^\]]*\]\([^)]*\)\s*/gu, '');
  const issues = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (kind === 'post') {
      if (!postText.trim() && selectedImages.post.length === 0) {
        errors.push(platform === 'x' ? xCopy.contentRequired : reviewCopy.binancePostContentRequired);
      }
      if ([...postText.trim()].length > postMaxCharacters) {
        errors.push(platform === 'x'
          ? xCopy.textTooLong(postMaxCharacters)
          : reviewCopy.binancePostTextTooLong(numberFormatter.format(postMaxCharacters)));
      }
      if (selectedImages.post.length > postMaxImages) {
        errors.push(platform === 'x'
          ? xCopy.maxImages(postMaxImages)
          : reviewCopy.binancePostMaxImages(numberFormatter.format(postMaxImages)));
      }
      return { errors, warnings };
    }
    if (!articleTitle.trim()) {
      errors.push(platform === 'binance' ? binanceCopy.titleRequired : reviewCopy.xArticleTitleRequired);
    }
    if (articleTitle.length > BINANCE_TITLE_MAX_CHARACTERS) {
      errors.push(platform === 'binance'
        ? binanceCopy.titleTooLong(BINANCE_TITLE_MAX_CHARACTERS)
        : reviewCopy.xArticleTitleTooLong(numberFormatter.format(BINANCE_TITLE_MAX_CHARACTERS)));
    }
    if (!articleBodyForSelection.trim()) {
      errors.push(platform === 'binance'
        ? binanceCopy.markdownRequired
        : reviewCopy.xArticleMarkdownRequired);
    }
    if (articleBodyForSelection.length > BINANCE_ARTICLE_MAX_CHARACTERS) {
      errors.push(platform === 'binance'
        ? binanceCopy.markdownTooLong
        : reviewCopy.xArticleMarkdownTooLong);
    }
    return { errors, warnings };
  }, [
    articleBodyForSelection,
    articleTitle,
    binanceCopy,
    kind,
    platform,
    postMaxCharacters,
    postMaxImages,
    postText,
    numberFormatter,
    reviewCopy,
    selectedImages.post.length,
    xCopy,
  ]);
  const contentWarnings = useMemo(() => kind === 'article'
    ? assembleBinanceArticle({
      intro: deck.captions?.blogIntro,
      sections: deck.captions?.blogSections,
      tags: deck.captions?.blogTags,
      slides: deck.slides.map(toExportSlide),
    }, binanceCopy).warnings
    : [], [binanceCopy, deck.captions, deck.slides, kind]);
  const commandActive = publication.command && ![
    'succeeded', 'failed', 'cancelled', 'expired', 'outcome_unknown',
  ].includes(publication.command.state);
  const draftRevision = draftRevisions[kind];
  const canDownloadFallback = (platform === 'x' && kind === 'post') || (
    platform === 'binance' && kind === 'article' && includeCover &&
    deck.cover?.status === 'generated' && Boolean(deck.cover.imageUrl)
  );

  const handleKindChange = (nextKind: PublicationKind) => {
    if (nextKind === kind || publication.isPreparing || commandActive) return;
    setKind(nextKind);
    setDraftLoadError(null);
    setDownloaded(false);
    setDownloadError(null);
  };

  const handlePlatformChange = (nextPlatform: Platform) => {
    if (nextPlatform === platform || publication.isPreparing || commandActive) return;
    setSelectedPlatform(nextPlatform);
    setKind(defaultKindFor(nextPlatform));
    setDraftRevisions({ post: null, article: null });
    setView('edit');
  };

  const saveDraft = async (): Promise<number> => {
    const orderedAssetIds = selectedAssetIds(deck, currentSelectedImages);
    const body: Record<string, unknown> = kind === 'post'
      ? { kind, expectedRevision: draftRevision, text: postText, orderedAssetIds }
      : { kind, expectedRevision: draftRevision, title: articleTitle, markdown: articleMarkdownForSelection(deck, articleMarkdown, selectedImages.article, true), orderedAssetIds };
    if (kind === 'article' && includeCover) {
      const coverAssetId = assetIdForUrl(deck.cover?.imageUrl);
      if (coverAssetId) body.cover = { assetId: coverAssetId, focalX: focal.x, focalY: focal.y, targetWidth: BINANCE_COVER_WIDTH, targetHeight: BINANCE_COVER_HEIGHT };
    }
    const savedResponse = await fetch(`/api/articles/${encodeURIComponent(deck.id)}/publications/${route}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const saved = await readPublicationResponse(savedResponse, copy.draftSaveFailed);
    setDraftRevisions((current) => ({ ...current, [kind]: saved.draft.revision }));
    return saved.draft.revision;
  };

  const handleSaveDraft = async () => {
    if (issues.errors.length > 0 || isDraftLoading || draftRevision === null || isSavingDraft) return;
    setIsSavingDraft(true);
    try {
      await saveDraft();
    } catch {
      setDownloadError(copy.draftSaveFailed);
    } finally {
      setIsSavingDraft(false);
    }
  };

  const toggleImage = (slideId: string) => {
    setDownloaded(false);
    setDownloadError(null);
    setSelectedImages((current) => {
      const selected = current[kind];
      const next = selected.includes(slideId)
        ? selected.filter((id) => id !== slideId)
        : selected.length < currentMaxImages
          ? [...selected, slideId]
          : selected;
      return { ...current, [kind]: next };
    });
  };

  const clearAllMedia = () => {
    setSelectedImages((current) => ({ ...current, [kind]: [] }));
    if (kind === 'article') setIncludeCover(false);
    setDownloaded(false);
    setDownloadError(null);
  };

  const handlePrepare = async () => {
    if (
      issues.errors.length > 0 || isDraftLoading || draftRevision === null ||
      publication.isPreparing || commandActive
    ) return;
    await publication.prepare(async () => {
      const revision = await saveDraft();
      const preparedResponse = await fetch(
        `/api/articles/${encodeURIComponent(deck.id)}/publications/${route}/prepare`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, expectedRevision: revision }),
        },
      );
      return readPublicationResponse(preparedResponse, copy.prepareFailed, commandCopy);
    });
  };

  const handleDownload = async () => {
    if (!canDownloadFallback || issues.errors.length > 0 || isDownloading) return;
    setIsDownloading(true);
    setDownloaded(false);
    setDownloadError(null);
    try {
      const selectedSlides = currentSelectedImages
        .map((slideId) => availableSlides.find((slide) => slide.id === slideId))
        .filter((slide): slide is DeckSlide => Boolean(slide?.imageUrl))
        .sort((left, right) => left.order - right.order);
      if (platform === 'x' && kind === 'post') {
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
          const blob = await readBlob(buildArticleSlideAssetUrl(deck.id, slide.imageUrl!), xCopy);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const mimeType = sniffImageMimeType(bytes);
          const dimensions = await getImageDimensions(blob, xCopy);
          images.push({
            slideId: slide.id,
            order,
            path: getXPostImagePath(order, mimeType),
            bytes: blob,
            mimeType,
            ...dimensions,
          });
        }
        const bundle = await createXPostBundle({ articleId: deck.id, text: postText, images });
        downloadBytes(bundle.bytes, safeDownloadName(deck.title, platform, kind));
      } else if (platform === 'binance' && kind === 'article' && deck.cover?.imageUrl) {
        const images = [] as Array<{
          slideId: string;
          order: number;
          path: string;
          bytes: Blob;
          mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
          width: number;
          height: number;
        }>;
        for (const slide of selectedSlides) {
          const deckOrder = deck.slides.findIndex((candidate) => candidate.id === slide.id);
          const blob = await readBlob(buildArticleSlideAssetUrl(deck.id, slide.imageUrl!), binanceCopy);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const mimeType = sniffImageMimeType(bytes);
          const dimensions = await getImageDimensions(blob, binanceCopy);
          images.push({
            slideId: slide.id,
            order: deckOrder,
            path: getSlideImagePath(deckOrder, mimeType),
            bytes: blob,
            mimeType,
            ...dimensions,
          });
        }
        const coverBlob = await readBlob(
          buildArticleSlideAssetUrl(deck.id, deck.cover.imageUrl),
          binanceCopy,
        );
        const cover = await cropCoverToJpeg(coverBlob, focal, binanceCopy);
        const bundle = await createBinanceBundle({
          articleId: deck.id,
          title: articleTitle,
          markdown: articleBodyForSelection,
          cover: {
            sourceSlideId: deck.cover.id,
            bytes: cover,
            mimeType: 'image/jpeg',
            width: BINANCE_COVER_WIDTH,
            height: BINANCE_COVER_HEIGHT,
          },
          images,
        });
        downloadBytes(bundle.bytes, safeDownloadName(articleTitle, platform, kind));
      }
      setDownloaded(true);
    } catch (error) {
      setDownloadError(error instanceof LocalizedExportError ? error.message : copy.bundleFailed);
    } finally {
      setIsDownloading(false);
    }
  };

  const coverPreviewUrl = deck.cover?.imageUrl
    ? (() => {
      try {
        return buildArticleSlideAssetUrl(deck.id, deck.cover!.imageUrl!);
      } catch {
        return null;
      }
    })()
    : null;
  const postTextLabel = platform === 'x' ? xCopy.textLabel : reviewCopy.binancePostText;
  const imagesTitle = kind === 'post'
    ? reviewCopy.addImagesOptional
    : reviewCopy.articleMediaOptional;
  const platformLabel = platform === 'binance' ? reviewCopy.binanceSquare : 'X';
  const kindLabel = kind === 'post' ? reviewCopy.post : reviewCopy.article;
  const dialogTitle = platform === 'x' && kind === 'article'
    ? reviewCopy.xArticleDialogTitle
    : copy.dialogTitle;
  const dialogDescription = kind === 'article'
    ? reviewCopy.articleDialogDescription
    : copy.dialogDescription;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-5xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        {!fixedPlatform ? (
          <div
            role="tablist"
            aria-label={reviewCopy.destinationLabel}
            className="flex w-fit gap-1 rounded-lg border border-border bg-muted/30 p-1"
          >
            {(['binance', 'x'] as const).map((candidate) => (
              <Button
                key={candidate}
                type="button"
                role="tab"
                aria-selected={platform === candidate}
                size="sm"
                variant={platform === candidate ? 'default' : 'outline'}
                disabled={publication.isPreparing || Boolean(commandActive)}
                onClick={() => handlePlatformChange(candidate)}
              >
                {candidate === 'binance' ? reviewCopy.binanceSquare : 'X'}
              </Button>
            ))}
          </div>
        ) : null}

        <div
          role="tablist"
          aria-label={reviewCopy.formatLabel}
          className="flex w-fit gap-1 rounded-lg border border-border bg-muted/30 p-1"
        >
          {(['post', 'article'] as const).map((candidate) => (
            <Button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={kind === candidate}
              size="sm"
              variant={kind === candidate ? 'default' : 'outline'}
              disabled={publication.isPreparing || Boolean(commandActive)}
              onClick={() => handleKindChange(candidate)}
            >
              {candidate === 'post' ? reviewCopy.post : reviewCopy.article}
            </Button>
          ))}
        </div>

        <div
          role="tablist"
          aria-label={reviewCopy.reviewViewLabel}
          className="flex w-fit gap-1 rounded-lg border border-border bg-muted/30 p-1"
        >
          {(['edit', 'preview'] as const).map((candidate) => (
            <Button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={view === candidate}
              size="sm"
              variant={view === candidate ? 'default' : 'outline'}
              onClick={() => setView(candidate)}
            >
              {candidate === 'edit' ? reviewCopy.editDraft : reviewCopy.previewPost}
            </Button>
          ))}
        </div>

        {view === 'preview' ? (
          <section data-publication-preview className="space-y-4 rounded-xl border border-border/80 bg-card/70 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-3">
              <div>
                <p className="text-sm font-semibold">
                  {reviewCopy.destinationFormat(platformLabel, kindLabel)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {reviewCopy.draftPreviewDescription}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {kind === 'post'
                  ? reviewCopy.characterCount(
                    numberFormatter.format(postCharacterCount),
                    numberFormatter.format(postMaxCharacters),
                  )
                  : reviewCopy.mediaCount(
                    numberFormatter.format(previewSlides.length),
                    numberFormatter.format(ARTICLE_MAX_IMAGES),
                  )}
              </span>
            </div>
            {kind === 'article' ? (
              <>
                <h2 className="text-2xl font-semibold">
                  {articleTitle || reviewCopy.untitledArticle}
                </h2>
                {includeCover && coverPreviewUrl ? (
                  <img
                    src={coverPreviewUrl}
                    alt={reviewCopy.selectedArticleCover}
                    className="aspect-[5/2] w-full rounded-lg object-cover"
                    style={{ objectPosition: `${focal.x * 100}% ${focal.y * 100}%` }}
                  />
                ) : null}
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown>{previewArticleMarkdown}</ReactMarkdown>
                </div>
              </>
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {postText || reviewCopy.mediaOnlyPost}
              </p>
            )}
            {previewSlides.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{previewSlides.map((slide) => <img key={slide.id} src={buildArticleSlideAssetUrl(deck.id, slide.imageUrl!)} alt={slide.title} className="aspect-square w-full rounded-lg object-cover" />)}</div> : null}
          </section>
        ) : null}

        {view === 'edit' ? <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-4">
            {kind === 'post' ? (
              <>
                {posts.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5" aria-label={xCopy.generatedPosts}>
                    {posts.map((post, index) => (
                      <Button
                        key={`${index}-${post.slice(0, 24)}`}
                        type="button"
                        size="sm"
                        variant={postText === post ? 'default' : 'outline'}
                        className="h-8 rounded-lg text-xs"
                        aria-label={xCopy.usePost(index + 1)}
                        onClick={() => setPostText(post)}
                      >
                        {xCopy.post(index + 1)}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="border border-dotted border-border px-3 py-2 text-xs text-muted-foreground">
                    {xCopy.noGeneratedPost}
                  </p>
                )}
                <div className="space-y-2">
                  <label htmlFor={`${platform}-post-text`} className="text-sm font-medium">
                    {postTextLabel}
                  </label>
                  <Textarea
                    id={`${platform}-post-text`}
                    aria-label={postTextLabel}
                    value={postText}
                    onChange={(event) => setPostText(event.target.value)}
                    className="min-h-48 resize-y font-sans text-sm leading-relaxed"
                  />
                  <p className="text-xs text-muted-foreground">
                    {reviewCopy.characterCount(
                      numberFormatter.format(postCharacterCount),
                      numberFormatter.format(postMaxCharacters),
                    )}
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <label htmlFor={`${platform}-article-title`} className="text-sm font-medium">
                    {binanceCopy.articleTitle}
                  </label>
                  <Input
                    id={`${platform}-article-title`}
                    aria-label={binanceCopy.articleTitle}
                    value={articleTitle}
                    onChange={(event) => setArticleTitle(event.target.value)}
                    maxLength={BINANCE_TITLE_MAX_CHARACTERS}
                  />
                  <p className="text-xs text-muted-foreground">
                    {reviewCopy.characterCount(
                      numberFormatter.format(articleTitle.length),
                      numberFormatter.format(BINANCE_TITLE_MAX_CHARACTERS),
                    )}
                  </p>
                </div>
                <div className="space-y-2">
                  <label htmlFor={`${platform}-article-markdown`} className="text-sm font-medium">
                    {binanceCopy.articleMarkdown}
                  </label>
                  <Textarea
                    id={`${platform}-article-markdown`}
                    aria-label={binanceCopy.articleMarkdown}
                    value={articleMarkdown}
                    onChange={(event) => setArticleMarkdown(event.target.value)}
                    className="min-h-64 font-mono text-xs sm:min-h-[28rem]"
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted-foreground">
                    {reviewCopy.characterCount(
                      numberFormatter.format(articleMarkdown.length),
                      numberFormatter.format(BINANCE_ARTICLE_MAX_CHARACTERS),
                    )}
                  </p>
                </div>
              </>
            )}

            {issues.errors.length > 0 ? (
              <div role="alert" className="space-y-1 border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {issues.errors.map((error) => <p key={error}>{error}</p>)}
              </div>
            ) : null}
            {contentWarnings.length > 0 ? (
              <div className="space-y-1 border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
                {[...new Set(contentWarnings)].map((warning) => <p key={warning}>{warning}</p>)}
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
                  onClick={() => setReloadToken((token) => token + 1)}
                >
                  {messages.common.retry}
                </Button>
              </div>
            ) : null}
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

          <aside className="min-w-0 space-y-4">
            {kind === 'article' ? (
              <div className="space-y-2 border border-dotted border-border p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <MoveDiagonal aria-hidden="true" className="size-4" /> {reviewCopy.articleCoverOptional}
                </p>
                {coverPreviewUrl ? (
                  <>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        aria-label={reviewCopy.useArticleCover}
                        checked={includeCover}
                        onChange={(event) => setIncludeCover(event.target.checked)}
                      />
                      {reviewCopy.useArticleCover}
                    </label>
                    <div className="overflow-hidden border bg-muted">
                      <img
                        src={coverPreviewUrl}
                        alt={platform === 'binance'
                          ? binanceCopy.coverPreviewAlt
                          : reviewCopy.xArticleCoverPreview}
                        className="aspect-[5/2] w-full object-cover"
                        style={{ objectPosition: `${focal.x * 100}% ${focal.y * 100}%` }}
                      />
                    </div>
                    {includeCover ? (
                      <>
                        <label className="block text-xs text-muted-foreground" htmlFor={`${platform}-cover-x`}>
                          {binanceCopy.horizontalFocus}
                        </label>
                        <input
                          id={`${platform}-cover-x`}
                          aria-label={binanceCopy.horizontalFocus}
                          type="range"
                          min="0"
                          max="100"
                          value={Math.round(focal.x * 100)}
                          onChange={(event) => setFocal((current) => ({
                            ...current,
                            x: Number(event.target.value) / 100,
                          }))}
                          className="w-full"
                        />
                        <label className="block text-xs text-muted-foreground" htmlFor={`${platform}-cover-y`}>
                          {binanceCopy.verticalFocus}
                        </label>
                        <input
                          id={`${platform}-cover-y`}
                          aria-label={binanceCopy.verticalFocus}
                          type="range"
                          min="0"
                          max="100"
                          value={Math.round(focal.y * 100)}
                          onChange={(event) => setFocal((current) => ({
                            ...current,
                            y: Number(event.target.value) / 100,
                          }))}
                          className="w-full"
                        />
                      </>
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {reviewCopy.noGeneratedCover} {reviewCopy.coverlessSupported}
                  </p>
                )}
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <ImageIcon aria-hidden="true" className="size-4" /> {imagesTitle}
                </p>
                <span className="font-mono text-[0.65rem] text-muted-foreground">
                  {reviewCopy.mediaCount(
                    numberFormatter.format(currentSelectedImages.length),
                    numberFormatter.format(currentMaxImages),
                  )}
                </span>
              </div>
              {(availableSlides.length > 0 || (kind === 'article' && coverPreviewUrl)) ? (
                <Button type="button" size="sm" variant="outline" onClick={clearAllMedia}>
                  {reviewCopy.clearAllMedia}
                </Button>
              ) : null}
              {availableSlides.length > 0 ? (
                <div className="space-y-1.5">
                  {availableSlides.map((slide, index) => {
                    const selected = currentSelectedImages.includes(slide.id);
                    const selectionFull = currentSelectedImages.length >= currentMaxImages;
                    return (
                      <label
                        key={slide.id}
                        className="flex min-w-0 items-start gap-2 border border-dotted border-border/75 px-2.5 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          aria-label={xCopy.useImage(slide.title)}
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
                  {kind === 'post' ? xCopy.noImages : reviewCopy.mediaOptional}
                </p>
              )}
            </div>
            <div className="border-t border-dotted border-border pt-3 text-xs leading-relaxed text-muted-foreground">
              {copy.fallbackSecurity}
            </div>
          </aside>
        </div> : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void handleSaveDraft()} disabled={issues.errors.length > 0 || isDraftLoading || draftRevision === null || isSavingDraft}>
            {isSavingDraft ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            {reviewCopy.saveDraft}
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {messages.common.cancel}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleDownload()}
            disabled={!canDownloadFallback || issues.errors.length > 0 || isDownloading}
            title={!canDownloadFallback
              ? reviewCopy.fallbackUnavailable
              : undefined}
          >
            {isDownloading ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Download aria-hidden="true" className="size-4" />}
            {isDownloading ? copy.creatingFallback : copy.downloadFallback}
          </Button>
          <Button
            type="button"
            onClick={() => void handlePrepare()}
            disabled={
              issues.errors.length > 0 || isDraftLoading || draftRevision === null ||
              publication.isPreparing || Boolean(commandActive)
            }
          >
            {(isDraftLoading || publication.isPreparing)
              ? <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              : null}
            {publication.isPreparing ? copy.preparing : copy.prepare}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
