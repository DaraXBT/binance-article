'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { ChevronLeft, Download, Loader2, Lock, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { CaptionViewer } from '@/components/caption-viewer';
import { ArticleCoverCard } from '@/components/article-cover-card';
import { GenerateAccessDialog } from '@/components/generate-access-dialog';
import { PublicationExportDialog } from '@/components/publication-export-dialog';
import {
  FrameCornerHandles,
  ScreenLine,
  SecureConsoleFrame,
} from '@/components/console/secure-console-frame';
import { StudioShell } from '@/components/studio/studio-shell';
import { GenerateAccessError } from '@/lib/generate-access-error';
import { DEFAULT_ILLUSTRATION_STYLE } from '@/lib/config';
import type { PublishingMessages } from '@/lib/publishing-i18n';
import { SlideEditor } from '@/components/slide-editor';
import { SlideList } from '@/components/slide-list';
import { SlidePreview } from '@/components/slide-preview';
import { ThemeToggle } from '@/components/theme-toggle';
import { useLanguage } from '@/components/language-provider';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Spinner } from '@/components/ui/spinner';
import {
  queryKeys,
  useCreateSlide,
  useDeck,
  useDeleteDeck,
  useDeleteSlide,
  useGenerationLock,
  useReorderSlides,
  useUpdateSlide,
} from '@/lib/hooks';
import type { DeckSlide, JobSummary, SlideUpdateRequest } from '@/lib/schemas';

interface DeckPageProps {
  params: Promise<{ id: string }>;
}

class LocalizedArticleError extends Error {}

function buildMovedSlideOrder(
  slides: DeckSlide[],
  slideId: string,
  direction: 'up' | 'down'
) {
  const currentIndex = slides.findIndex((slide) => slide.id === slideId);
  if (currentIndex === -1) {
    return null;
  }

  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= slides.length) {
    return null;
  }

  const reorderedSlides = [...slides];
  const [movedSlide] = reorderedSlides.splice(currentIndex, 1);
  reorderedSlides.splice(targetIndex, 0, movedSlide);

  return reorderedSlides.map((slide, index) => ({
    id: slide.id,
    order: index,
  }));
}

async function waitForJob(
  jobId: string,
  copy: PublishingMessages['articlePage'],
): Promise<JobSummary> {
  const maxAttempts = 60;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(`/api/jobs/${jobId}`, {
      cache: 'no-store',
    });
    const job = (await response.json()) as JobSummary & { error?: string };

    if (!response.ok) {
      throw new LocalizedArticleError(copy.jobStatusFailed);
    }

    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new LocalizedArticleError(copy.jobTimedOut);
}

export default function DeckPage({ params }: DeckPageProps) {
  const { id: deckId } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { messages } = useLanguage();
  const publishingCopy = messages.publishing;
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null);
  const [retryFeedback, setRetryFeedback] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [coverFeedback, setCoverFeedback] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [editorFeedback, setEditorFeedback] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'slides' | 'editor' | 'preview'>('slides');
  const [showAccessDialog, setShowAccessDialog] = useState(false);
  const [accessRetryTarget, setAccessRetryTarget] = useState<'slides' | 'cover'>('slides');
  const [showPublicationReview, setShowPublicationReview] = useState(false);
  const { generationLocked, unlockGeneration, markGenerationAccessLost } = useGenerationLock();
  const { data, isLoading, isError, refetch } = useDeck(deckId, { pollActiveJob: true });
  const deck = data ?? null;

  const createSlide = useCreateSlide(deckId);
  const updateSlide = useUpdateSlide(deckId);
  const deleteSlide = useDeleteSlide(deckId);
  const reorderSlides = useReorderSlides(deckId);
  const deleteDeck = useDeleteDeck();

  const retryFailedImages = useMutation({
    mutationFn: async (): Promise<JobSummary> => {
      const res = await fetch(`/api/articles/${deckId}/generate-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          illustrationStyle: deck?.illustrationStyle || DEFAULT_ILLUSTRATION_STYLE,
          mode: 'failed',
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (GenerateAccessError.isGenerateAccessResponse(res.status, data)) {
          throw new GenerateAccessError();
        }
        throw new Error(data?.error || messages.deckPage.imageRetryFailed);
      }

      return waitForJob(data.jobId, publishingCopy.articlePage);
    },
    onMutate: () => {
      setRetryFeedback(null);
      setRetryError(null);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.detail(deckId) });
      await refetch();

      if (result.status !== 'completed') {
        setRetryError(result.error || messages.deckPage.imageRetryFailed);
        return;
      }

      const imageSummary = result.result as
        | { generated?: number; status?: 'success' | 'partial' | 'failed' }
        | null
        | undefined;

      if (imageSummary?.status === 'failed') {
        setRetryError(messages.deckPage.imageRetryFailed);
        return;
      }

      setRetryFeedback(messages.deckPage.imageRetrySuccess(imageSummary?.generated ?? 0));
    },
    onError: (error) => {
      if (error instanceof GenerateAccessError) {
        setAccessRetryTarget('slides');
        markGenerationAccessLost();
        setShowAccessDialog(true);
        return;
      }
      setRetryError(error instanceof Error ? error.message : messages.deckPage.imageRetryFailed);
    },
  });

  const retryCover = useMutation({
    mutationFn: async (): Promise<JobSummary> => {
      const res = await fetch(`/api/articles/${deckId}/generate-cover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const responseBody = await res.json().catch(() => null);
      if (!res.ok) {
        if (GenerateAccessError.isGenerateAccessResponse(res.status, responseBody)) {
          throw new GenerateAccessError();
        }
        throw new LocalizedArticleError(publishingCopy.cover.startFailed);
      }
      return waitForJob(responseBody.jobId, publishingCopy.articlePage);
    },
    onMutate: () => {
      setCoverFeedback(null);
      setCoverError(null);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.detail(deckId) });
      await refetch();
      if (result.status !== 'completed') {
        setCoverError(publishingCopy.cover.resultFailed);
        return;
      }
      setCoverFeedback(publishingCopy.cover.readyFeedback);
    },
    onError: (error) => {
      if (error instanceof GenerateAccessError) {
        setAccessRetryTarget('cover');
        markGenerationAccessLost();
        setShowAccessDialog(true);
        return;
      }
      setCoverError(
        error instanceof LocalizedArticleError
          ? error.message
          : publishingCopy.cover.failed,
      );
    },
  });

  useEffect(() => {
    if (!deck?.slides?.length) {
      setActiveSlideId(null);
      return;
    }

    const activeSlideStillExists = deck.slides.some((slide) => slide.id === activeSlideId);
    if (!activeSlideId || !activeSlideStillExists) {
      setActiveSlideId(deck.slides[0].id);
    }
  }, [activeSlideId, deck?.slides]);

  const slides = deck?.slides ?? [];
  const activeSlide = slides.find((slide) => slide.id === activeSlideId) ?? null;
  const failedSlides = slides.filter((slide) => slide.imageStatus === 'failed');
  const pendingSlides = slides.filter((slide) => slide.imageStatus === 'pending' && !slide.imageUrl);
  // Pending slides show the loader both during an explicit retry and while
  // the initial generation job is still producing images.
  const isDeckGenerating = deck?.status === 'generating' || deck?.status === 'queued';
  const generatingSlideIds = new Set([
    ...(retryFailedImages.isPending ? failedSlides.map((slide) => slide.id) : []),
    ...(isDeckGenerating ? pendingSlides.map((slide) => slide.id) : []),
  ]);
  const isActiveSlideGenerating = activeSlide
    ? generatingSlideIds.has(activeSlide.id)
    : false;
  const isMutating =
    createSlide.isPending ||
    updateSlide.isPending ||
    deleteSlide.isPending ||
    reorderSlides.isPending ||
    deleteDeck.isPending;

  const resetEditorMessages = () => {
    setEditorFeedback(null);
    setEditorError(null);
  };

  const handleAddSlide = () => {
    resetEditorMessages();

    createSlide.mutate(
      {
        title: messages.slideEditor.untitledSlide,
        subtitle: '',
        bullets: [],
        notes: '',
      },
      {
        onSuccess: async (createdSlide) => {
          setMobileTab('editor');
          setEditorFeedback(messages.deckPage.slideAdded);
          await refetch();
          setActiveSlideId(createdSlide.id);
        },
        onError: (error) => {
          setEditorError(
            error instanceof Error ? error.message : messages.deckPage.slideAddFailed
          );
        },
      }
    );
  };

  const handleSaveSlide = (draft: SlideUpdateRequest) => {
    if (!activeSlide) {
      return;
    }

    resetEditorMessages();

    updateSlide.mutate(
      {
        slideId: activeSlide.id,
        ...draft,
      },
      {
        onSuccess: () => {
          setEditorFeedback(messages.deckPage.slideSaved);
        },
        onError: (error) => {
          setEditorError(
            error instanceof Error ? error.message : messages.deckPage.slideSaveFailed
          );
        },
      }
    );
  };

  const handleDeleteSlide = () => {
    if (!activeSlide) {
      return;
    }

    resetEditorMessages();
    const currentIndex = slides.findIndex((slide) => slide.id === activeSlide.id);
    const nextSlide =
      slides[currentIndex + 1] ?? slides[currentIndex - 1] ?? null;

    deleteSlide.mutate(activeSlide.id, {
      onSuccess: () => {
        setActiveSlideId(nextSlide?.id ?? null);
        setEditorFeedback(messages.deckPage.slideDeleted);
      },
      onError: (error) => {
        setEditorError(
          error instanceof Error ? error.message : messages.deckPage.slideDeleteFailed
        );
      },
    });
  };

  const handleMoveSlide = (slideId: string, direction: 'up' | 'down') => {
    const slideOrder = buildMovedSlideOrder(slides, slideId, direction);
    if (!slideOrder) {
      return;
    }

    resetEditorMessages();

    reorderSlides.mutate(slideOrder, {
      onSuccess: () => {
        setEditorFeedback(messages.deckPage.slidesReordered);
      },
      onError: (error) => {
        setEditorError(
          error instanceof Error ? error.message : messages.deckPage.slideReorderFailed
        );
      },
    });
  };

  const handleDeleteDeck = () => {
    deleteDeck.mutate(deckId, {
      onSuccess: () => {
        router.push('/workspace');
      },
      onError: (error) => {
        setEditorError(
          error instanceof Error ? error.message : messages.deckPage.deleteArticleFailed
        );
      },
    });
  };

  if (isLoading) {
    return (
      <SecureConsoleFrame
        variant="focus"
        eyebrow={publishingCopy.articlePage.loadingEyebrow}
        title={publishingCopy.articlePage.loadingTitle}
        panelClassName="mx-auto w-full max-w-lg"
      >
        <div className="flex min-h-28 items-center gap-3" role="status" aria-live="polite">
          <span className="inline-flex size-9 items-center justify-center border border-dotted border-border text-primary">
            <Spinner />
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">{publishingCopy.articlePage.checkingArticle}</span>
        </div>
      </SecureConsoleFrame>
    );
  }

  if (isError || !deck) {
    return (
      <SecureConsoleFrame
        variant="focus"
        eyebrow={publishingCopy.articlePage.errorEyebrow}
        title={messages.deckPage.failedToLoad}
        panelClassName="mx-auto w-full max-w-lg border-destructive/45 bg-destructive/[0.025]"
      >
        <Button asChild variant="outline" size="sm" className="w-fit">
          <Link href="/workspace">{messages.common.backToDashboard}</Link>
        </Button>
      </SecureConsoleFrame>
    );
  }

  return (
    <>
    <StudioShell
      surface="editor"
      frameVariant="focus"
      className="studio-editor-shell"
      shellClassName="max-w-[96rem]"
    >
      <div className="flex min-h-0 flex-1 flex-col">
      <header className="console-header studio-toolbar sticky top-0 z-10 border-b border-dotted border-border/80 bg-background">
        <div className="flex min-w-0 w-full flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link
              href="/workspace"
              className="inline-flex items-center gap-1 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              {messages.deckPage.back}
            </Link>
            <h1 className="truncate text-base font-semibold tracking-normal sm:text-lg">{deck.title}</h1>
          </div>
          <div className="studio-editor-actions flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
            <ThemeToggle />
            {failedSlides.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                className="gap-2 rounded-lg"
                onClick={() => {
                  // Same locked behavior as the cover retry: open the unlock
                  // dialog instead of a dead disabled button.
                  if (generationLocked) {
                    setAccessRetryTarget('slides');
                    setShowAccessDialog(true);
                    return;
                  }
                  retryFailedImages.mutate();
                }}
                disabled={retryFailedImages.isPending}
              >
                {retryFailedImages.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : generationLocked ? (
                  <Lock className="h-4 w-4" />
                ) : null}
                <span className="hidden sm:inline">
                  {retryFailedImages.isPending
                    ? messages.deckPage.retryingImages
                    : messages.deckPage.retryFailedImages}
                </span>
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="gap-2 rounded-lg"
              onClick={() => setShowPublicationReview(true)}
              disabled={slides.length === 0}
              aria-label="Review and publish"
              data-testid="open-publication-review"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Review &amp; publish</span>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="destructive"
                  className="gap-2 rounded-lg"
                  disabled={deleteDeck.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="hidden sm:inline">{messages.deckPage.deleteArticle}</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="console-dialog border-dotted p-4 sm:p-5">
                <FrameCornerHandles />
                <AlertDialogHeader>
                  <AlertDialogTitle>{messages.deckPage.deleteArticleTitle}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {messages.deckPage.deleteArticleDescription}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-lg">{messages.common.cancel}</AlertDialogCancel>
                  <AlertDialogAction className="rounded-lg" onClick={handleDeleteDeck}>
                    {messages.common.delete}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </header>
      <ScreenLine />

      {failedSlides.length > 0 || pendingSlides.length > 0 || retryFeedback || retryError || coverFeedback || coverError || editorFeedback || editorError ? (
        <div className="border-b border-dotted border-border/80 bg-muted/20 px-4 py-2.5">
        <div className="studio-feedback flex flex-wrap items-center gap-3 text-sm">
            {failedSlides.length > 0 ? (
              <p className="font-medium text-destructive">
                {messages.deckPage.imagesFailed(failedSlides.length)}
              </p>
            ) : null}
            {pendingSlides.length > 0 ? (
              <p className="text-muted-foreground">
                {messages.deckPage.imagesPending(pendingSlides.length)}
              </p>
            ) : null}
            {retryFeedback ? <p className="font-medium text-primary">{retryFeedback}</p> : null}
            {retryError ? <p className="text-destructive">{retryError}</p> : null}
            {coverFeedback ? <p className="font-medium text-primary">{coverFeedback}</p> : null}
            {coverError ? <p className="text-destructive">{coverError}</p> : null}
            {editorFeedback ? <p className="font-medium text-primary">{editorFeedback}</p> : null}
            {editorError ? <p className="text-destructive">{editorError}</p> : null}
          </div>
        </div>
      ) : null}

      <ArticleCoverCard
        articleId={deckId}
        cover={deck.cover}
        isRetrying={retryCover.isPending}
        onRetry={() => {
          if (generationLocked) {
            setAccessRetryTarget('cover');
            setShowAccessDialog(true);
            return;
          }
          retryCover.mutate();
        }}
      />

      <div className="border-b border-dotted border-border/80 bg-muted/20 lg:hidden">
        <div className="flex" role="tablist" aria-label={publishingCopy.articlePage.editorViews}>
          {(['slides', 'editor', 'preview'] as const).map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={mobileTab === tab}
              onClick={() => setMobileTab(tab)}
              className={`flex-1 px-3 py-2.5 font-mono text-[0.62rem] font-medium uppercase tracking-[0.12em] transition-colors ${
                mobileTab === tab
                  ? 'border-b-2 border-primary bg-background text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'slides'
                ? messages.deckPage.tabsSlides(slides.length)
                : tab === 'editor'
                  ? messages.deckPage.tabsEditor
                  : messages.deckPage.tabsPreview}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden lg:hidden">
        {mobileTab === 'slides' ? (
          <SlideList
            articleId={deckId}
            slides={slides}
            activeSlideId={activeSlideId}
            onSelectSlide={(slideId) => {
              setActiveSlideId(slideId);
              setMobileTab('preview');
            }}
            onAddSlide={handleAddSlide}
            onMoveUp={(slideId) => handleMoveSlide(slideId, 'up')}
            onMoveDown={(slideId) => handleMoveSlide(slideId, 'down')}
            isReordering={isMutating}
            isAdding={createSlide.isPending}
            generatingSlideIds={generatingSlideIds}
          />
        ) : null}
        {mobileTab === 'editor' ? (
          <div className="h-full overflow-y-auto p-4">
            <SlideEditor
              slide={activeSlide}
              onSave={handleSaveSlide}
              onDelete={handleDeleteSlide}
              isSaving={updateSlide.isPending}
              isDeleting={deleteSlide.isPending}
            />
          </div>
        ) : null}
        {mobileTab === 'preview' ? (
          <div className="h-full overflow-y-auto">
            <div className="p-4">
              <SlidePreview
                articleId={deckId}
                slide={activeSlide}
                theme={deck.theme || undefined}
                isGenerating={isActiveSlideGenerating}
              />
            </div>
            <div className="border-t border-border">
              <CaptionViewer captions={deck.captions} />
            </div>
          </div>
        ) : null}
      </div>

      <div className="hidden flex-1 overflow-hidden lg:block">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize="20%" minSize="15%" maxSize="30%">
            <SlideList
              articleId={deckId}
              slides={slides}
              activeSlideId={activeSlideId}
              onSelectSlide={setActiveSlideId}
              onAddSlide={handleAddSlide}
              onMoveUp={(slideId) => handleMoveSlide(slideId, 'up')}
              onMoveDown={(slideId) => handleMoveSlide(slideId, 'down')}
              isReordering={isMutating}
              isAdding={createSlide.isPending}
              generatingSlideIds={generatingSlideIds}
            />
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel defaultSize="30%" minSize="25%" maxSize="50%">
            <div className="h-full overflow-y-auto border-r border-border p-6">
              <SlideEditor
                slide={activeSlide}
                onSave={handleSaveSlide}
                onDelete={handleDeleteSlide}
                isSaving={updateSlide.isPending}
                isDeleting={deleteSlide.isPending}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel defaultSize="50%" minSize="30%">
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize="60%" minSize="30%">
                <div className="h-full overflow-auto p-6">
                  <SlidePreview
                    articleId={deckId}
                    slide={activeSlide}
                    theme={deck.theme || undefined}
                    isGenerating={isActiveSlideGenerating}
                  />
                </div>
              </ResizablePanel>

              <ResizableHandle />

              <ResizablePanel defaultSize="40%" minSize="20%">
                <CaptionViewer captions={deck.captions} />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      </div>
    </StudioShell>
      <GenerateAccessDialog
        open={showAccessDialog}
        onOpenChange={setShowAccessDialog}
        onSuccess={() => {
          unlockGeneration();
          setShowAccessDialog(false);
          if (accessRetryTarget === 'cover') retryCover.mutate();
          else retryFailedImages.mutate();
        }}
      />
      <PublicationExportDialog
        open={showPublicationReview}
        onOpenChange={setShowPublicationReview}
        deck={deck}
      />
    </>
  );
}
