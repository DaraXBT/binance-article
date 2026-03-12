'use client';

import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { CaptionViewer } from '@/components/caption-viewer';
import { GenerateAccessDialog } from '@/components/generate-access-dialog';
import { GenerateAccessError } from '@/lib/generate-access-error';
import { LanguageToggle } from '@/components/language-toggle';
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
  useReorderSlides,
  useUpdateSlide,
  useWorkspace,
} from '@/lib/hooks';
import { DeckDetailResponse, DeckSlide, JobSummary, SlideUpdateRequest } from '@/lib/schemas';

interface DeckPageProps {
  params: Promise<{ id: string }>;
}

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

async function waitForJob(jobId: string): Promise<JobSummary> {
  const maxAttempts = 60;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(`/api/jobs/${jobId}`, {
      cache: 'no-store',
    });
    const job = (await response.json()) as JobSummary & { error?: string };

    if (!response.ok) {
      throw new Error(job.error || 'Failed to fetch job status');
    }

    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error('Timed out while waiting for the background job to finish.');
}

export default function DeckPage({ params }: DeckPageProps) {
  const { id: deckId } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { messages } = useLanguage();
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null);
  const [retryFeedback, setRetryFeedback] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [editorFeedback, setEditorFeedback] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'slides' | 'editor' | 'preview'>('slides');
  const [showAccessDialog, setShowAccessDialog] = useState(false);
  const accessCodeRef = useRef<string>('');

  const { data: workspace } = useWorkspace();
  const { data, isLoading, isError, refetch } = useDeck(deckId);
  const deck = (data ?? null) as DeckDetailResponse | null;

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
          illustrationStyle: deck?.illustrationStyle || 'pixel-art',
          mode: 'failed',
          ...(accessCodeRef.current ? { accessCode: accessCodeRef.current } : {}),
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (GenerateAccessError.isGenerateAccessResponse(res.status, data)) {
          throw new GenerateAccessError();
        }
        throw new Error(data?.error || messages.deckPage.imageRetryFailed);
      }

      accessCodeRef.current = '';
      return waitForJob(data.jobId);
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
        accessCodeRef.current = '';
        setShowAccessDialog(true);
        return;
      }
      setRetryError(error instanceof Error ? error.message : messages.deckPage.imageRetryFailed);
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
        router.push('/');
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
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (isError || !deck) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-destructive">{messages.deckPage.failedToLoad}</p>
        <Link href="/">
          <Button variant="outline" size="sm">{messages.common.backToDashboard}</Button>
        </Link>
      </div>
    );
  }

  return (
    <>
    <div className="flex h-screen flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-background">
        <div className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-4 sm:py-4">
          <div className="min-w-0 flex-1">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              {messages.deckPage.back}
            </Link>
            <h1 className="truncate text-lg font-bold sm:text-2xl">{deck.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LanguageToggle />
            <ThemeToggle />
            {failedSlides.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => {
                  if (workspace?.generateAccessEnabled) {
                    accessCodeRef.current = '';
                    setShowAccessDialog(true);
                    return;
                  }
                  retryFailedImages.mutate();
                }}
                disabled={retryFailedImages.isPending}
              >
                {retryFailedImages.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                <span className="hidden sm:inline">
                  {retryFailedImages.isPending
                    ? messages.deckPage.retryingImages
                    : messages.deckPage.retryFailedImages}
                </span>
              </Button>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="destructive"
                  className="gap-2"
                  disabled={deleteDeck.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="hidden sm:inline">{messages.deckPage.deleteArticle}</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{messages.deckPage.deleteArticleTitle}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {messages.deckPage.deleteArticleDescription}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteDeck}>
                    {messages.common.delete}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      {failedSlides.length > 0 || pendingSlides.length > 0 || retryFeedback || retryError || editorFeedback || editorError ? (
        <div className="border-b border-border bg-muted/30 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
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
            {editorFeedback ? <p className="font-medium text-primary">{editorFeedback}</p> : null}
            {editorError ? <p className="text-destructive">{editorError}</p> : null}
          </div>
        </div>
      ) : null}

      <div className="border-b border-border bg-muted/30 md:hidden">
        <div className="flex">
          {(['slides', 'editor', 'preview'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setMobileTab(tab)}
              className={`flex-1 px-3 py-2.5 text-xs font-medium uppercase tracking-wider transition-colors ${
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

      <div className="flex-1 overflow-hidden md:hidden">
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
              <SlidePreview articleId={deckId} slide={activeSlide} theme={deck.theme || undefined} />
            </div>
            <div className="border-t border-border">
              <CaptionViewer captions={deck.captions} />
            </div>
          </div>
        ) : null}
      </div>

      <div className="hidden flex-1 overflow-hidden md:block">
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
                  <SlidePreview articleId={deckId} slide={activeSlide} theme={deck.theme || undefined} />
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
      <GenerateAccessDialog
        open={showAccessDialog}
        onOpenChange={setShowAccessDialog}
        onSuccess={(code) => {
          accessCodeRef.current = code;
          setShowAccessDialog(false);
          retryFailedImages.mutate();
        }}
      />
    </>
  );
}
