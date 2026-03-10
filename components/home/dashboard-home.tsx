'use client';

import { useDeferredValue, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FolderOpenDot, Layers3, Loader2, MessageSquarePlus, MoreHorizontal, Search, Sparkles } from 'lucide-react';
import { LanguageToggle } from '@/components/language-toggle';
import { useLanguage } from '@/components/language-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { RecoveryKeyDialog } from '@/components/workspace/recovery-key-dialog';
import { WorkspaceOnboarding } from '@/components/workspace/workspace-onboarding';
import { WorkspaceSidebarFooter } from '@/components/workspace/workspace-sidebar-footer';
import { Textarea } from '@/components/ui/textarea';
import { ILLUSTRATION_STYLES, type IllustrationStyleId } from '@/lib/config';
import { formatRelativeTime } from '@/lib/i18n';
import { useDecks, useDeleteDeck, useUpdateDeck, useWorkspace } from '@/lib/hooks';

type DeckListItem = {
  id: string;
  title: string;
  description?: string | null;
  status?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    slides?: number;
  };
};

type HomeFetch = typeof fetch;

interface SubmitPromptArticleOptions {
  title: string;
  prompt: string;
  slideCount?: number;
  illustrationStyle?: IllustrationStyleId;
  fetchImpl?: HomeFetch;
}

const HOME_SLIDE_COUNT_OPTIONS = [1, 3, 5, 7, 10, 15] as const;
const DEFAULT_HOME_SLIDE_COUNT = 1;
const DEFAULT_HOME_ILLUSTRATION_STYLE: IllustrationStyleId = 'pixel-art';
const sidebarSkeletonWidths = ['88%', '64%', '76%', '58%', '71%', '67%'] as const;

async function readHomeResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || fallbackMessage);
  }

  return data as T;
}

export async function requestPromptSuggestion({
  title,
  fetchImpl = fetch,
}: {
  title: string;
  fetchImpl?: HomeFetch;
}) {
  const trimmedTitle = title.trim();

  if (!trimmedTitle) {
    throw new Error('A topic is required.');
  }

  const response = await fetchImpl('/api/articles/generate-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: trimmedTitle }),
  });

  const data = await readHomeResponse<{ prompt?: string }>(response, 'Failed to generate prompt');

  if (!data.prompt?.trim()) {
    throw new Error('Failed to generate prompt');
  }

  return data.prompt;
}

export function getAiSuggestGlowClassName({
  hasTopic,
  isSuggesting,
}: {
  hasTopic: boolean;
  isSuggesting: boolean;
}) {
  return hasTopic && !isSuggesting
    ? 'ai-suggest-glow pointer-events-none absolute inset-0 rounded-md bg-gradient-to-r from-yellow-400/20 via-amber-400/90 to-orange-400/25 [background-size:200%_100%] p-px opacity-100 transition-opacity duration-200 motion-safe:animate-[ai-suggest-sweep_2.2s_linear_infinite]'
    : 'ai-suggest-glow pointer-events-none absolute inset-0 rounded-md bg-gradient-to-r from-yellow-400/20 via-amber-400/90 to-orange-400/25 [background-size:200%_100%] p-px opacity-0 transition-opacity duration-200';
}

export async function submitPromptArticle({
  title,
  prompt,
  slideCount = 1,
  illustrationStyle = 'pixel-art',
  fetchImpl = fetch,
}: SubmitPromptArticleOptions) {
  const trimmedTitle = title.trim();
  const trimmedPrompt = prompt.trim();

  if (!trimmedTitle) {
    throw new Error('A topic is required.');
  }

  if (!trimmedPrompt) {
    throw new Error('A prompt is required.');
  }

  const createResponse = await fetchImpl('/api/articles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: trimmedTitle,
      description: trimmedPrompt.slice(0, 200),
      content: trimmedPrompt,
      illustrationStyle,
    }),
  });

  const createdArticle = await readHomeResponse<{ id?: string }>(
    createResponse,
    'Failed to generate article'
  );
  const deckId = createdArticle.id;

  if (!deckId) {
    throw new Error('Failed to generate article');
  }

  const generateResponse = await fetchImpl(`/api/articles/${deckId}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      articleContent: trimmedPrompt,
      slideCount,
      illustrationStyle,
      mode: 'prompt',
    }),
  });

  await readHomeResponse(generateResponse, 'Failed to generate article');

  const imageResponse = await fetchImpl(`/api/articles/${deckId}/generate-images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ illustrationStyle }),
  });

  await imageResponse.json().catch(() => null);

  return { deckId };
}

function DeckSidebarRow({
  deck,
  language,
}: {
  deck: DeckListItem;
  language: 'km' | 'en';
}) {
  const { messages } = useLanguage();
  const updateDeck = useUpdateDeck();
  const deleteDeck = useDeleteDeck();
  const inputRef = useRef<HTMLInputElement>(null);
  const skipRenameSubmitRef = useRef(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(deck.title);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  useEffect(() => {
    if (!isRenaming) {
      setDraftTitle(deck.title);
      setRenameError(null);
    }
  }, [deck.title, isRenaming]);

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  const description =
    deck.description ||
    `${deck._count?.slides || 0} ${messages.deckCard.slides.toLowerCase()} • ${messages.deckCard.updated} ${formatRelativeTime(new Date(deck.updatedAt), language)}`;

  const handleRenameStart = () => {
    skipRenameSubmitRef.current = false;
    setDraftTitle(deck.title);
    setRenameError(null);
    setIsRenaming(true);
  };

  const handleRenameCancel = () => {
    skipRenameSubmitRef.current = false;
    setDraftTitle(deck.title);
    setRenameError(null);
    setIsRenaming(false);
  };

  const handleRenameSubmit = () => {
    if (skipRenameSubmitRef.current) {
      skipRenameSubmitRef.current = false;
      return;
    }

    const trimmedTitle = draftTitle.trim();

    if (!trimmedTitle) {
      setRenameError(messages.dashboard.renameTitleRequired);
      return;
    }

    if (trimmedTitle === deck.title) {
      setDraftTitle(deck.title);
      setRenameError(null);
      setIsRenaming(false);
      return;
    }

    updateDeck.mutate(
      {
        deckId: deck.id,
        title: trimmedTitle,
      },
      {
        onSuccess: () => {
          setRenameError(null);
          setIsRenaming(false);
        },
        onError: (error) => {
          setRenameError(
            error instanceof Error ? error.message : messages.dashboard.renameArticleFailed
          );
          setDraftTitle(deck.title);
          setIsRenaming(false);
        },
      }
    );
  };

  return (
    <SidebarMenuItem className="group/item">
      <div className="relative">
        {isRenaming ? (
          <div className="flex min-w-0 items-start gap-2 rounded-md px-3 py-3 pr-12 text-sidebar-foreground">
            <FolderOpenDot className="mt-1 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <Input
                ref={inputRef}
                value={draftTitle}
                onChange={(event) => {
                  setDraftTitle(event.target.value);
                  if (renameError) {
                    setRenameError(null);
                  }
                }}
                onBlur={handleRenameSubmit}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    skipRenameSubmitRef.current = true;
                    event.currentTarget.blur();
                    handleRenameCancel();
                  }
                }}
                className="h-7 bg-background"
                disabled={updateDeck.isPending}
              />
              <p className="mt-1 truncate text-xs text-sidebar-foreground/65">{description}</p>
              {renameError ? (
                <p className="mt-1 truncate text-xs text-destructive">{renameError}</p>
              ) : null}
            </div>
          </div>
        ) : (
          <SidebarMenuButton asChild className="h-auto px-3 py-3 pr-12">
            <Link href={`/articles/${deck.id}`}>
              <FolderOpenDot className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{deck.title}</p>
                <p className="mt-1 truncate text-xs text-sidebar-foreground/65">{description}</p>
                {renameError ? (
                  <p className="mt-1 truncate text-xs text-destructive">{renameError}</p>
                ) : null}
              </div>
            </Link>
          </SidebarMenuButton>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover/item:opacity-100 group-focus-within/item:opacity-100 data-[state=open]:opacity-100"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              aria-label={`${messages.common.rename} ${deck.title}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                handleRenameStart();
              }}
            >
              {messages.common.rename}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={(event) => {
                event.preventDefault();
                setIsDeleteOpen(true);
              }}
            >
              {messages.common.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{messages.deckPage.deleteArticleTitle}</AlertDialogTitle>
              <AlertDialogDescription>
                {messages.deckPage.deleteArticleDescription}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.stopPropagation();
                  deleteDeck.mutate(deck.id, {
                    onSuccess: () => {
                      setIsDeleteOpen(false);
                    },
                  });
                }}
              >
                {messages.common.delete}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SidebarMenuItem>
  );
}

function DeckSidebarList({
  decks,
  isLoading,
  isError,
  query,
  onQueryChange,
  language,
}: {
  decks: DeckListItem[];
  isLoading: boolean;
  isError: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  language: 'km' | 'en';
}) {
  const { messages } = useLanguage();

  return (
    <>
      <SidebarHeader className="gap-3 border-b border-sidebar-border/70 p-3">
        <Link href="/" className="flex min-w-0 items-center gap-3 px-2 py-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-sidebar-primary text-sidebar-primary-foreground">
            <Layers3 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-sidebar-foreground">xArticle</p>
            <p className="truncate text-xs text-sidebar-foreground/70">
              {messages.dashboard.workspaceDashboard}
            </p>
          </div>
        </Link>

        <Button asChild className="h-10 justify-start">
          <Link href="/new">
            <MessageSquarePlus className="h-4 w-4" />
            {messages.common.newDeck}
          </Link>
        </Button>

        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sidebar-foreground/60" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={messages.dashboard.searchDecks}
            className="h-10 w-full border border-sidebar-border/70 bg-background pl-9 pr-3 text-sm text-foreground shadow-none outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </label>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        <SidebarGroup className="pt-0">
          <SidebarGroupLabel>{messages.dashboard.allDecks}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading ? (
                sidebarSkeletonWidths.map((width, index) => (
                  <SidebarMenuSkeleton key={index} showIcon width={width} />
                ))
              ) : isError ? (
                <div className="border border-destructive/20 bg-destructive/5 px-3 py-4 text-sm text-sidebar-foreground/80">
                  {messages.dashboard.couldNotLoadDeckList}
                </div>
              ) : decks.length > 0 ? (
                decks.map((deck) => <DeckSidebarRow key={deck.id} deck={deck} language={language} />)
              ) : (
                <div className="border border-sidebar-border/70 bg-background px-3 py-4 text-sm text-sidebar-foreground/70">
                  {query ? messages.dashboard.noMatchingDecks : messages.dashboard.noDecksYet}
                </div>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </>
  );
}

export function DashboardHome() {
  const router = useRouter();
  const { language, messages } = useLanguage();
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('');
  const [prompt, setPrompt] = useState('');
  const [slideCount, setSlideCount] = useState<number>(DEFAULT_HOME_SLIDE_COUNT);
  const [illustrationStyle, setIllustrationStyle] =
    useState<IllustrationStyleId>(DEFAULT_HOME_ILLUSTRATION_STYLE);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const { data: workspace, isLoading: isWorkspaceLoading } = useWorkspace();
  const hasWorkspace = workspace?.hasWorkspace ?? false;
  const { data, isLoading, isError, refetch } = useDecks(hasWorkspace);
  const decks = (data ?? []) as DeckListItem[];

  const filteredDecks = decks.filter((deck) => {
    if (deferredQuery.trim()) {
      const needle = deferredQuery.trim().toLowerCase();
      if (
        !deck.title.toLowerCase().includes(needle) &&
        !deck.description?.toLowerCase().includes(needle)
      ) {
        return false;
      }
    }

    return true;
  });

  const handleSuggest = async () => {
    if (!topic.trim()) {
      setComposerError(messages.dashboard.topicRequired);
      return;
    }

    setIsSuggesting(true);
    setComposerError(null);

    try {
      const suggestedPrompt = await requestPromptSuggestion({ title: topic });
      setPrompt(suggestedPrompt);
    } catch (error) {
      setComposerError(
        error instanceof Error ? error.message : messages.dashboard.promptGenerateFailed
      );
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!topic.trim()) {
      setComposerError(messages.dashboard.topicRequired);
      return;
    }

    if (!prompt.trim()) {
      setComposerError(messages.dashboard.promptRequired);
      return;
    }

    setIsSubmitting(true);
    setComposerError(null);

    try {
      const { deckId } = await submitPromptArticle({
        title: topic,
        prompt,
        slideCount,
        illustrationStyle,
      });
      await refetch();
      router.push(`/articles/${deckId}`);
    } catch (error) {
      setComposerError(
        error instanceof Error ? error.message : messages.dashboard.articleGenerateFailed
      );
      setIsSubmitting(false);
    }
  };

  const helperText = composerError
    ? composerError
    : prompt.trim()
      ? messages.dashboard.promptHintReady
      : messages.dashboard.promptHintEmpty;

  if (isWorkspaceLoading && !workspace) {
    return <main className="min-h-screen bg-background" />;
  }

  if (!hasWorkspace) {
    return <WorkspaceOnboarding />;
  }

  return (
    <SidebarProvider defaultOpen className="min-h-screen w-full bg-background">
      <Sidebar className="z-30 border-r border-sidebar-border/70" collapsible="offcanvas">
        <DeckSidebarList
          decks={filteredDecks}
          isLoading={isLoading}
          isError={isError}
          query={query}
          onQueryChange={setQuery}
          language={language}
        />
        <SidebarFooter className="border-t border-sidebar-border/70">
          <WorkspaceSidebarFooter
            accessKeyPrefix={workspace.accessKeyPrefix ?? '—'}
            recoveryKey={workspace.recoveryKey ?? null}
          />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <RecoveryKeyDialog recoveryKey={workspace.recoveryKey ?? null} />

      <SidebarInset className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(120,119,198,0.06),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.08),transparent_30%)]">
        <header className="sticky top-0 z-10 border-b border-border/70 bg-background/85 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <SidebarTrigger className="size-9 border border-border/70" />

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground sm:text-base">
                {messages.dashboard.headerTitle}
              </p>
            </div>

            <LanguageToggle />
            <ThemeToggle />

            <Button asChild className="px-4 sm:px-5">
              <Link href="/new">
                <MessageSquarePlus className="h-4 w-4" />
                <span className="hidden sm:inline">{messages.common.newDeck}</span>
              </Link>
            </Button>
          </div>
        </header>

        <div className="flex min-h-[calc(100vh-4rem)] flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-14">
          <section className="mx-auto w-full max-w-3xl">
            <div className="mb-8 text-center">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                {messages.dashboard.promptHomeTitle}
              </h1>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                {messages.dashboard.promptHomeSubtitle}
              </p>
            </div>

            <div className="space-y-6">
              <form
                onSubmit={handleSubmit}
                className="overflow-hidden border border-border/70 bg-background/90 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.45)]"
              >
                <div className="border-b border-border/70 px-4 py-4 sm:px-5">
                  <Input
                    value={topic}
                    onChange={(event) => {
                      setTopic(event.target.value);
                      if (composerError) {
                        setComposerError(null);
                      }
                    }}
                    placeholder={messages.dashboard.topicPlaceholder}
                    className="h-12 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="px-4 py-4 sm:px-5 sm:py-5">
                  <Textarea
                    value={prompt}
                    onChange={(event) => {
                      setPrompt(event.target.value);
                      if (composerError) {
                        setComposerError(null);
                      }
                    }}
                    placeholder={messages.dashboard.promptPlaceholder}
                    rows={8}
                    className="min-h-[180px] resize-y border-0 bg-transparent px-0 text-sm leading-7 shadow-none focus-visible:ring-0"
                    disabled={isSubmitting || isSuggesting}
                  />

                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p
                      className={`text-sm ${
                        composerError ? 'text-destructive' : 'text-muted-foreground'
                      }`}
                    >
                      {helperText}
                    </p>

                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                      <Select
                        value={String(slideCount)}
                        onValueChange={(value) => setSlideCount(Number(value))}
                      >
                        <SelectTrigger
                          aria-label={messages.dashboard.slideCountLabel}
                          size="sm"
                          className="w-full sm:w-auto"
                          disabled={isSubmitting || isSuggesting}
                        >
                          <SelectValue placeholder={messages.dashboard.slideCountLabel} />
                        </SelectTrigger>
                        <SelectContent>
                          {HOME_SLIDE_COUNT_OPTIONS.map((count) => (
                            <SelectItem key={count} value={String(count)}>
                              {count}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={illustrationStyle}
                        onValueChange={(value) => setIllustrationStyle(value as IllustrationStyleId)}
                      >
                        <SelectTrigger
                          aria-label={messages.dashboard.illustrationStyleLabel}
                          size="sm"
                          className="w-full sm:w-[11rem]"
                          disabled={isSubmitting || isSuggesting}
                        >
                          <SelectValue placeholder={messages.dashboard.illustrationStyleLabel} />
                        </SelectTrigger>
                        <SelectContent>
                          {ILLUSTRATION_STYLES.map((style) => {
                            const localizedStyle =
                              messages.newDeck.styleOptions[
                                style.id as keyof typeof messages.newDeck.styleOptions
                              ];

                            return (
                              <SelectItem key={style.id} value={style.id}>
                                {localizedStyle.name}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>

                      <div className="relative inline-flex">
                        <span
                          aria-hidden="true"
                          className={getAiSuggestGlowClassName({
                            hasTopic: Boolean(topic.trim()),
                            isSuggesting,
                          })}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleSuggest}
                          disabled={isSuggesting || isSubmitting}
                          className="gap-2"
                        >
                          {isSuggesting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Sparkles className="h-4 w-4" />
                          )}
                          {isSuggesting
                            ? messages.dashboard.aiSuggestLoading
                            : messages.dashboard.aiSuggest}
                        </Button>
                      </div>

                      <Button type="submit" disabled={isSubmitting || isSuggesting} className="gap-2">
                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {isSubmitting
                          ? messages.dashboard.generateLoading
                          : messages.dashboard.generateAction}
                      </Button>
                    </div>
                  </div>
                </div>
              </form>

            </div>
          </section>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
