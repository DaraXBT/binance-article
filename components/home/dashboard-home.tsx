'use client';

import { useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FolderOpenDot,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Search,
} from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import {
  FrameCornerHandles,
} from '@/components/console/secure-console-frame';
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
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from '@/components/ui/sidebar';
import { GenerateAccessDialog } from '@/components/generate-access-dialog';
import { WorkspaceOnboarding } from '@/components/workspace/workspace-onboarding';
import { WorkspaceSidebarFooter } from '@/components/workspace/workspace-sidebar-footer';
import { RecoverWorkspaceDialog } from '@/components/workspace/recover-workspace-dialog';
import { ConnectionsDialog } from '@/components/settings/connections-dialog';
import {
  DEFAULT_ILLUSTRATION_STYLE,
  type IllustrationStyleId,
} from '@/lib/config';
import { cn } from '@/lib/utils';
import { formatRelativeTime, type Language } from '@/lib/i18n';
import {
  useCreateWorkspace,
  useDecks,
  useDeleteDeck,
  useGenerationLock,
  useUpdateDeck,
  useWorkspace,
} from '@/lib/hooks';
import { GenerateAccessError } from '@/lib/generate-access-error';
import {
  ANONYMOUS_GENERATION_INTENT_KEY,
  claimAnonymousGenerationIntent,
  createAnonymousGenerationIntent,
  loadAnonymousGenerationIntent,
  removeAnonymousGenerationIntent,
  saveAnonymousGenerationIntent,
  updateAnonymousGenerationIntent,
  type AnonymousGenerationIntent,
} from '@/lib/client/anonymous-draft';
import {
  MINIMUM_PROMPT_LENGTH,
  PromptComposer,
  type ComposerSlideCount,
} from './prompt-composer';
import {
  ArticleStudioShell,
} from './article-studio-shell';
import { StudioSidebarBrand } from './studio-sidebar-brand';

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
  title?: string;
  prompt: string;
  slideCount?: number;
  illustrationStyle?: IllustrationStyleId;
  /** A stable key lets a browser retry the same intent without creating a duplicate. */
  idempotencyKey?: string;
  /** Resume an article that was created before generation access was granted. */
  articleId?: string;
  onStage?: (stage: 'article_created' | 'generation_started', value: { articleId: string; jobId?: string }) => void;
  fetchImpl?: HomeFetch;
}

// Match the anonymous composer's default so the experience is identical
// before and after signing in.
const DEFAULT_HOME_SLIDE_COUNT = 5;
const DEFAULT_HOME_ILLUSTRATION_STYLE = DEFAULT_ILLUSTRATION_STYLE;
const sidebarSkeletonWidths = ['88%', '64%', '76%', '58%', '71%', '67%'] as const;

function WorkspaceBootstrapScreen({
  title,
  description,
  status,
  children,
  tone = 'default',
}: {
  title: string;
  description: string;
  status: string;
  children?: ReactNode;
  tone?: 'default' | 'error';
}) {
  const isError = tone === 'error';

  return (
    <main
      data-workspace-bootstrap
      className="flex min-h-dvh w-full bg-background text-foreground"
      aria-labelledby="workspace-bootstrap-title"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="w-full max-w-lg">
          <p
            className={cn(
              'text-xs font-medium tracking-wide text-muted-foreground',
              isError && 'text-destructive',
            )}
            role={isError ? 'alert' : 'status'}
            aria-live="polite"
          >
            {status}
          </p>
          <h1 id="workspace-bootstrap-title" className="mt-3 text-2xl font-semibold leading-tight tracking-normal sm:text-3xl">
            {title}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
          {children ? <div className="mt-5">{children}</div> : null}
        </div>
      </div>
    </main>
  );
}

async function readHomeResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (GenerateAccessError.isGenerateAccessResponse(response.status, data)) {
      throw new GenerateAccessError(data?.error);
    }
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
    body: JSON.stringify({
      title: trimmedTitle,
    }),
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
    ? 'ai-suggest-frame pointer-events-none absolute inset-0 border border-primary/40 opacity-100 transition-opacity duration-150'
    : 'ai-suggest-frame pointer-events-none absolute inset-0 border border-primary/20 opacity-0 transition-opacity duration-150';
}

function extractTitleFromContent(content: string): string {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim().slice(0, 80);
  const firstLine = content.split('\n').find((line) => line.trim().length > 0);
  return firstLine ? firstLine.trim().slice(0, 80) : 'Untitled';
}

export async function submitPromptArticle({
  title,
  prompt,
  slideCount = 1,
  illustrationStyle = DEFAULT_ILLUSTRATION_STYLE,
  idempotencyKey,
  articleId: existingArticleId,
  onStage,
  fetchImpl = fetch,
}: SubmitPromptArticleOptions) {
  const trimmedPrompt = prompt.trim();
  const trimmedTitle = title?.trim() || extractTitleFromContent(trimmedPrompt);

  if (!trimmedPrompt) {
    throw new Error('A prompt is required.');
  }
  if (trimmedPrompt.length < MINIMUM_PROMPT_LENGTH) {
    throw new Error(`A prompt of at least ${MINIMUM_PROMPT_LENGTH} characters is required.`);
  }

  let deckId = existingArticleId;

  if (!deckId) {
    const createHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (idempotencyKey) createHeaders['Idempotency-Key'] = idempotencyKey;
    const createResponse = await fetchImpl('/api/articles', {
      method: 'POST',
      headers: createHeaders,
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
    deckId = createdArticle.id;
  }

  if (!deckId) {
    throw new Error('Failed to generate article');
  }

  onStage?.('article_created', { articleId: deckId });

  const generationHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idempotencyKey) generationHeaders['Idempotency-Key'] = idempotencyKey;
  const generateResponse = await fetchImpl(`/api/articles/${deckId}/generate`, {
    method: 'POST',
    headers: generationHeaders,
    body: JSON.stringify({
      articleContent: trimmedPrompt,
      slideCount,
      illustrationStyle,
      mode: 'prompt',
    }),
  });

  const generationJob = await readHomeResponse<{ jobId?: string }>(
    generateResponse,
    'Failed to generate article'
  );

  if (!generationJob.jobId) {
    throw new Error('Failed to start article generation');
  }

  onStage?.('generation_started', { articleId: deckId, jobId: generationJob.jobId });

  // Keep the public helper contract intentionally small; callers that need the
  // job checkpoint receive it through `onStage` above.
  return { deckId };
}

function DeckSidebarRow({
  deck,
  language,
}: {
  deck: DeckListItem;
  language: Language;
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
      <div className="group relative">
        {isRenaming ? (
          <div className="flex min-w-0 items-start gap-2 border border-dotted border-sidebar-border/80 bg-sidebar-accent/25 px-3 py-3 pr-12 text-sidebar-foreground">
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
          <SidebarMenuButton asChild className="h-auto rounded-lg border border-transparent px-3 py-3 pr-12 transition-colors hover:border-dotted hover:border-sidebar-border/80 hover:bg-sidebar-accent/40">
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
              className="absolute right-2 top-2 z-10 size-7 rounded-lg opacity-100 lg:opacity-0 lg:group-hover/item:opacity-100 lg:group-focus-within/item:opacity-100 data-[state=open]:opacity-100"
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
  language: Language;
}) {
  const { messages } = useLanguage();

  return (
    <>
      <SidebarHeader className="gap-2 border-b border-dotted border-sidebar-border/80 p-3 group-data-[collapsible=icon]:border-b-0 group-data-[collapsible=icon]:p-2">
        <StudioSidebarBrand
          href="/workspace"
          description={messages.dashboard.workspaceDashboard}
          openLabel="Open article history"
          closeLabel="Close article history"
        />

        <Button
          asChild
          className="h-9 justify-start rounded-lg group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
        >
          <Link
            href="/new"
            aria-label={messages.common.newDeck}
            title={messages.common.newDeck}
          >
            <MessageSquarePlus className="h-4 w-4" />
            <span className="group-data-[collapsible=icon]:hidden">
              {messages.common.newDeck}
            </span>
          </Link>
        </Button>

        <label className="relative block group-data-[collapsible=icon]:hidden">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-sidebar-foreground/60" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={messages.dashboard.searchDecks}
            className="h-9 w-full rounded-lg border border-dotted border-sidebar-border/80 bg-background/50 pl-8 pr-3 text-sm text-foreground shadow-none outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </label>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2 group-data-[collapsible=icon]:hidden">
        <SidebarGroup className="pt-0">
          <SidebarGroupLabel className="h-7 px-2 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-sidebar-foreground/60">
            {messages.dashboard.allDecks}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading ? (
                sidebarSkeletonWidths.map((width, index) => (
                  <SidebarMenuSkeleton key={index} showIcon width={width} />
                ))
              ) : isError ? (
                <div className="border border-dotted border-destructive/35 bg-destructive/5 px-3 py-3 text-sm text-sidebar-foreground/80">
                  {messages.dashboard.couldNotLoadDeckList}
                </div>
              ) : decks.length > 0 ? (
                decks.map((deck) => <DeckSidebarRow key={deck.id} deck={deck} language={language} />)
              ) : (
                <div className="border border-dotted border-sidebar-border/80 bg-background/40 px-3 py-3 text-sm text-sidebar-foreground/70">
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

type HomeSubmissionSnapshot = {
  prompt: string;
  slideCount: ComposerSlideCount;
  illustrationStyle: IllustrationStyleId;
};

type SubmissionCheckpoint = HomeSubmissionSnapshot & {
  idempotencyKey: string;
  articleId?: string;
  jobId?: string;
};

const RESUME_WORKSPACE_CHOICE_PREFIX = `${ANONYMOUS_GENERATION_INTENT_KEY}:workspace-choice:`;

function readSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

interface DashboardHomeProps {
  resumeIntentId?: string | null;
  resumeRequested?: boolean;
  settingsOpen?: boolean;
  canManageAccess?: boolean;
  actor?: { name: string; email: string };
}

export function DashboardHome({
  resumeIntentId = null,
  resumeRequested = Boolean(resumeIntentId),
  settingsOpen = false,
  canManageAccess = false,
  actor,
}: DashboardHomeProps) {
  const router = useRouter();
  const { language, messages } = useLanguage();
  const [query, setQuery] = useState('');
  const [prompt, setPrompt] = useState('');
  const [slideCount, setSlideCount] = useState<ComposerSlideCount>(DEFAULT_HOME_SLIDE_COUNT);
  const [illustrationStyle, setIllustrationStyle] =
    useState<IllustrationStyleId>(DEFAULT_HOME_ILLUSTRATION_STYLE);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAccessDialog, setShowAccessDialog] = useState(false);
  const [isProvisioningWorkspace, setIsProvisioningWorkspace] = useState(false);
  const [provisioningError, setProvisioningError] = useState<string | null>(null);
  const [provisionAttempt, setProvisionAttempt] = useState(0);
  const [resumeIntent, setResumeIntent] = useState<AnonymousGenerationIntent | null>(null);
  const [resumeReady, setResumeReady] = useState(!resumeRequested);
  const [resumeAllowed, setResumeAllowed] = useState(!resumeRequested);
  const [resumeBypassed, setResumeBypassed] = useState(false);
  const [resumeNeedsAction, setResumeNeedsAction] = useState(false);
  const [workspaceCreatedForResume, setWorkspaceCreatedForResume] = useState(false);
  const [workspaceChoiceOpen, setWorkspaceChoiceOpen] = useState(false);
  const [recoverWorkspaceOpen, setRecoverWorkspaceOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const pendingRetryRef = useRef<(() => void) | null>(null);
  const accessDialogSucceededRef = useRef(false);
  const autoProvisionAttemptedRef = useRef(false);
  const resumeStartedRef = useRef(false);
  const freshResumeRef = useRef(false);
  const resumeIntentRef = useRef<AnonymousGenerationIntent | null>(null);
  const submissionRef = useRef<SubmissionCheckpoint | null>(null);
  const recoverySucceededRef = useRef(false);
  const recoveryReturnsToChoiceRef = useRef(false);
  const deferredQuery = useDeferredValue(query);
  const createWorkspace = useCreateWorkspace();
  const {
    data: workspace,
    isLoading: isWorkspaceLoading,
    error: workspaceError,
    refetch: refetchWorkspace,
  } = useWorkspace();
  const hasWorkspace = workspace?.hasWorkspace ?? false;
  const { data, isLoading, isError, refetch } = useDecks(hasWorkspace);
  const decks = (data ?? []) as DeckListItem[];
  const { generationLocked, unlockGeneration, markGenerationAccessLost } = useGenerationLock();
  const isWorkspaceBusy = isProvisioningWorkspace || Boolean(createWorkspace.isPending);
  const accountLabel = actor?.name?.trim() || actor?.email?.trim() || 'Account';

  const handleConnectionsOpenChange = (open: boolean) => {
    const params = new URLSearchParams(window.location.search);
    if (open) params.set('settings', 'connections');
    else params.delete('settings');
    const queryString = params.toString();
    router.replace(queryString ? `/workspace?${queryString}` : '/workspace', { scroll: false });
  };

  const handleOpenConnections = () => {
    const params = new URLSearchParams(window.location.search);
    params.set('settings', 'connections');
    router.push(`/workspace?${params.toString()}`, { scroll: false });
  };

  const handleUnavailableResumeContinue = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete('resume');
    const queryString = params.toString();
    setResumeBypassed(true);
    setResumeAllowed(true);
    setComposerError(null);
    router.replace(queryString ? `/workspace?${queryString}` : '/workspace', { scroll: false });
  };

  // A newly enrolled account has no workspace yet. Provision it silently so a
  // user can land on the composer without an extra onboarding click.
  useEffect(() => {
    if (
      isWorkspaceLoading ||
      workspaceError ||
      !workspace ||
      workspace.hasWorkspace ||
      (resumeRequested && !resumeBypassed && (!resumeReady || !resumeIntent)) ||
      autoProvisionAttemptedRef.current
    ) {
      return;
    }

    autoProvisionAttemptedRef.current = true;
    setIsProvisioningWorkspace(true);
    setProvisioningError(null);
    try {
      createWorkspace.mutate(undefined, {
        onSuccess: (result) => {
          setIsProvisioningWorkspace(false);
          if (resumeRequested && resumeIntent && result?.created) setWorkspaceCreatedForResume(true);
          void refetchWorkspace();
        },
        onError: (error) => {
          setIsProvisioningWorkspace(false);
          setProvisioningError(error instanceof Error ? error.message : 'Failed to open your account library.');
        },
      });
    } catch (error) {
      setIsProvisioningWorkspace(false);
      setProvisioningError(error instanceof Error ? error.message : 'Failed to open your account library.');
    }
  }, [
    createWorkspace,
    isWorkspaceLoading,
    workspace,
    workspaceError,
    resumeIntentId,
    resumeRequested,
    resumeBypassed,
    resumeReady,
    resumeIntent,
    refetchWorkspace,
    provisionAttempt,
  ]);

  const applyResumeIntent = (intent: AnonymousGenerationIntent | null) => {
    resumeIntentRef.current = intent;
    setResumeIntent(intent);
    if (!intent) return;
    setPrompt(intent.prompt);
    setSlideCount(intent.slideCount);
    setIllustrationStyle(intent.illustrationStyle);
    submissionRef.current = {
      prompt: intent.prompt,
      slideCount: intent.slideCount,
      illustrationStyle: intent.illustrationStyle,
      idempotencyKey: intent.intentId,
      articleId: intent.articleId,
      jobId: intent.jobId,
    };
  };

  // Claim the submitted anonymous intent exactly once. The URL contains only
  // the opaque UUID; all prompt data remains in tab-scoped storage.
  useEffect(() => {
    if (!resumeRequested) {
      freshResumeRef.current = false;
      applyResumeIntent(null);
      setResumeReady(true);
      setResumeAllowed(true);
      return;
    }

    if (!resumeIntentId) {
      freshResumeRef.current = false;
      setComposerError(messages.publicHome.resumeUnavailable);
      setResumeReady(true);
      setResumeAllowed(true);
      return;
    }

    const storage = readSessionStorage();
    if (!storage) {
      setComposerError(messages.publicHome.storageError);
      setResumeReady(true);
      setResumeAllowed(true);
      return;
    }

    try {
      const loaded = loadAnonymousGenerationIntent(storage, { intentId: resumeIntentId });
      if (!loaded) {
        freshResumeRef.current = false;
        setComposerError(messages.publicHome.resumeUnavailable);
        setResumeReady(true);
        setResumeAllowed(true);
        return;
      }
      const isFreshSubmission = loaded.stage === 'submitted';
      // React StrictMode may immediately re-run this effect after the first
      // claim has changed `submitted` to `resuming`. Preserve freshness only
      // for that same mounted intent; a real reload starts with a fresh ref and
      // therefore requires the explicit Continue action below.
      const isFreshClaim = isFreshSubmission || Boolean(
        freshResumeRef.current &&
        loaded.stage === 'resuming' &&
        resumeIntentRef.current?.intentId === loaded.intentId,
      );
      freshResumeRef.current = isFreshClaim;
      const claimed = isFreshSubmission
        ? claimAnonymousGenerationIntent(storage, { intentId: resumeIntentId })
        : loaded;
      applyResumeIntent(claimed ?? loaded);
      setResumeNeedsAction(
        !isFreshClaim &&
        loaded.stage !== 'editing' &&
        loaded.stage !== 'generation_started',
      );
    } catch {
      setComposerError(messages.publicHome.storageError);
      setResumeAllowed(true);
    } finally {
      setResumeReady(true);
    }
    // The server-provided opaque id is intentionally the only dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeIntentId, resumeRequested]);

  const resumeChoiceKey = resumeIntentId
    ? `${RESUME_WORKSPACE_CHOICE_PREFIX}${resumeIntentId}`
    : null;

  const readResumeChoice = () => {
    const storage = readSessionStorage();
    if (!storage || !resumeChoiceKey) return null;
    try {
      const value = storage.getItem(resumeChoiceKey);
      return value === 'continue' || value === 'import' ? value : null;
    } catch {
      return null;
    }
  };

  const saveResumeChoice = (choice: 'continue' | 'import') => {
    const storage = readSessionStorage();
    if (!storage || !resumeChoiceKey) return;
    try {
      storage.setItem(resumeChoiceKey, choice);
    } catch {
      // A denied sessionStorage should not prevent the signed-in flow.
    }
  };

  // Pause a submitted anonymous draft whenever the server says this pristine
  // account can still be replaced by a legacy import. Enrollment normally
  // provisions the account before this page mounts, so client creation history
  // must never be used as the authority for this decision.
  useEffect(() => {
    if (
      !resumeIntentId ||
      !resumeReady ||
      !resumeIntent ||
      !workspace?.hasWorkspace
    ) {
      return;
    }
    if (readResumeChoice()) {
      setResumeAllowed(true);
      return;
    }
    if (workspace.canReplaceWithLegacy) {
      setResumeAllowed(false);
      setWorkspaceChoiceOpen(true);
    } else {
      setResumeAllowed(true);
    }
    // Fallback provisioning updates this state so a mocked or delayed
    // workspace refetch still re-evaluates the authoritative server flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeIntentId, resumeReady, resumeIntent, workspace, workspaceCreatedForResume]);

  const handleContinueWithNewWorkspace = () => {
    saveResumeChoice('continue');
    setWorkspaceChoiceOpen(false);
    setResumeAllowed(true);
  };

  const handleWorkspaceChoiceOpenChange = (open: boolean) => {
    // This choice protects a pristine account workspace from becoming
    // ineligible for legacy import. Escape/outside dismissal must not bypass it.
    if (open) setWorkspaceChoiceOpen(true);
  };

  const handleImportOldWorkspace = () => {
    setWorkspaceChoiceOpen(false);
    recoverySucceededRef.current = false;
    recoveryReturnsToChoiceRef.current = true;
    setRecoverWorkspaceOpen(true);
  };

  const handleSidebarImport = () => {
    recoverySucceededRef.current = false;
    recoveryReturnsToChoiceRef.current = false;
    setRecoverWorkspaceOpen(true);
  };

  const handleWorkspaceRecovered = () => {
    recoverySucceededRef.current = true;
    saveResumeChoice('import');
    setRecoverWorkspaceOpen(false);
    setWorkspaceCreatedForResume(false);
    setResumeAllowed(true);
    void refetchWorkspace();
  };

  const handleRecoverWorkspaceOpenChange = (open: boolean) => {
    setRecoverWorkspaceOpen(open);
    if (!open && !recoverySucceededRef.current && recoveryReturnsToChoiceRef.current) {
      // Keep the first-run choice available if the user closes recovery
      // without importing a key.
      setWorkspaceChoiceOpen(true);
    }
  };

  const persistResumeStage = (
    stage: AnonymousGenerationIntent['stage'],
    values: { articleId?: string; jobId?: string } = {},
  ): boolean => {
    const current = resumeIntentRef.current;
    const storage = readSessionStorage();
    if (!current) return true;
    if (!storage) return false;
    try {
      const next = updateAnonymousGenerationIntent(storage, current, {
        stage,
        ...values,
      });
      resumeIntentRef.current = next;
      setResumeIntent(next);
      return true;
    } catch {
      return false;
    }
  };

  const snapshotForCurrentPrompt = (): HomeSubmissionSnapshot => ({
    prompt: prompt.trim(),
    slideCount,
    illustrationStyle,
  });

  const checkpointFor = (snapshot: HomeSubmissionSnapshot): SubmissionCheckpoint => {
    const existing = submissionRef.current;
    if (
      existing &&
      existing.prompt === snapshot.prompt &&
      existing.slideCount === snapshot.slideCount &&
      existing.illustrationStyle === snapshot.illustrationStyle
    ) {
      return existing;
    }
    const intent = resumeIntentRef.current;
    const intentMatchesSnapshot = Boolean(
      intent &&
      intent.prompt === snapshot.prompt &&
      intent.slideCount === snapshot.slideCount &&
      intent.illustrationStyle === snapshot.illustrationStyle,
    );
    const checkpoint: SubmissionCheckpoint = {
      ...snapshot,
      // A changed prompt is a new logical request. Do not reuse the old
      // intent key (which may already be an article/job id).
      idempotencyKey: intentMatchesSnapshot && intent ? intent.intentId : newIdempotencyKey(),
      articleId: intentMatchesSnapshot ? intent?.articleId : undefined,
      jobId: intentMatchesSnapshot ? intent?.jobId : undefined,
    };
    submissionRef.current = checkpoint;
    return checkpoint;
  };

  const replaceEditedResumeCheckpoint = (checkpoint: SubmissionCheckpoint): boolean => {
    const current = resumeIntentRef.current;
    if (!current || current.intentId === checkpoint.idempotencyKey) return true;
    const storage = readSessionStorage();
    if (!storage) return false;

    try {
      const replacement = createAnonymousGenerationIntent({
        intentId: checkpoint.idempotencyKey,
        prompt: checkpoint.prompt,
        slideCount: checkpoint.slideCount,
        illustrationStyle: checkpoint.illustrationStyle,
        stage: 'resuming',
      });
      saveAnonymousGenerationIntent(storage, replacement);
      try {
        window.history.replaceState(
          window.history.state,
          '',
          `/workspace?resume=${encodeURIComponent(replacement.intentId)}`,
        );
      } catch {
        // Keep storage and the URL paired if browser history is unavailable.
        saveAnonymousGenerationIntent(storage, current);
        return false;
      }
      resumeIntentRef.current = replacement;
      setResumeIntent(replacement);
      submissionRef.current = checkpoint;
      return true;
    } catch {
      return false;
    }
  };

  const runSuggest = async (title: string) => {
    setIsSuggesting(true);
    setComposerError(null);
    try {
      const suggestedPrompt = await requestPromptSuggestion({ title });
      setPrompt(suggestedPrompt);
    } catch (error) {
      if (error instanceof GenerateAccessError) {
        markGenerationAccessLost();
        pendingRetryRef.current = () => void runSuggest(title);
        accessDialogSucceededRef.current = false;
        setShowAccessDialog(true);
        return;
      }
      setComposerError(error instanceof Error ? error.message : messages.dashboard.promptGenerateFailed);
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleSuggest = async () => {
    const title = prompt.trim();
    if (!title) {
      setComposerError(messages.dashboard.promptRequired);
      return;
    }
    if (generationLocked) {
      pendingRetryRef.current = () => void runSuggest(title);
      accessDialogSucceededRef.current = false;
      setShowAccessDialog(true);
      return;
    }
    await runSuggest(title);
  };

  const runSubmit = async (snapshot: HomeSubmissionSnapshot) => {
    const checkpoint = checkpointFor(snapshot);
    let persistsResumeCheckpoint =
      resumeIntentRef.current?.intentId === checkpoint.idempotencyKey;
    if (
      resumeIntentRef.current &&
      !persistsResumeCheckpoint &&
      !replaceEditedResumeCheckpoint(checkpoint)
    ) {
      setComposerError(messages.publicHome.storageError);
      setResumeNeedsAction(true);
      return;
    }
    persistsResumeCheckpoint = Boolean(
      resumeIntentRef.current?.intentId === checkpoint.idempotencyKey,
    );
    setIsSubmitting(true);
    setComposerError(null);

    try {
      const { deckId } = await submitPromptArticle({
        prompt: checkpoint.prompt,
        slideCount: checkpoint.slideCount,
        illustrationStyle: checkpoint.illustrationStyle,
        idempotencyKey: checkpoint.idempotencyKey,
        articleId: checkpoint.articleId,
        onStage: (stage, value) => {
          checkpoint.articleId = value.articleId;
          if (value.jobId) checkpoint.jobId = value.jobId;
          if (!persistsResumeCheckpoint) return;
          if (!persistResumeStage(stage, value) && stage === 'article_created') {
            // Without a durable checkpoint an interrupted submit could strand
            // the created article, so abort before the paid generate call.
            throw new Error(messages.publicHome.storageError);
          }
          // A checkpoint failure after generation started is moot: the job is
          // already running server-side and we navigate to the article next,
          // so it must not surface as a generation failure.
        },
      });
      if (resumeIntentRef.current) {
        const storage = readSessionStorage();
        if (storage) {
          try {
            removeAnonymousGenerationIntent(storage);
          } catch {
            // Leaving a resumable checkpoint is safer than losing the draft.
          }
        }
      }
      // The article/job endpoints are authoritative; a stale sidebar refresh
      // must not turn a successful generation start into a visible failure.
      try {
        await refetch();
      } catch {
        // Navigation can continue with the article id returned above.
      }
      router.push(`/articles/${deckId}`);
    } catch (error) {
      if (error instanceof GenerateAccessError) {
        markGenerationAccessLost();
        pendingRetryRef.current = () => void runSubmit(snapshot);
        accessDialogSucceededRef.current = false;
        setShowAccessDialog(true);
        return;
      }
      if (persistsResumeCheckpoint && resumeIntentRef.current && !checkpoint.jobId) {
        persistResumeStage('needs_retry', checkpoint.articleId ? { articleId: checkpoint.articleId } : {});
      }
      setComposerError(error instanceof Error ? error.message : messages.dashboard.articleGenerateFailed);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    const snapshot = snapshotForCurrentPrompt();
    if (!snapshot.prompt) {
      setComposerError(messages.dashboard.promptRequired);
      return;
    }
    if (snapshot.prompt.length < MINIMUM_PROMPT_LENGTH) {
      setComposerError(messages.publicHome.promptTooShort);
      return;
    }
    if (generationLocked) {
      pendingRetryRef.current = () => void runSubmit(snapshot);
      accessDialogSucceededRef.current = false;
      setShowAccessDialog(true);
      return;
    }
    await runSubmit(snapshot);
  };

  const handleAccessDialogChange = (open: boolean) => {
    setShowAccessDialog(open);
    if (open) {
      accessDialogSucceededRef.current = false;
      return;
    }
    if (!accessDialogSucceededRef.current) {
      pendingRetryRef.current = null;
      if (resumeIntentRef.current) setResumeNeedsAction(true);
    }
  };

  const handleAccessSuccess = () => {
    accessDialogSucceededRef.current = true;
    unlockGeneration();
    const retry = pendingRetryRef.current;
    pendingRetryRef.current = null;
    if (retry) void retry();
  };

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin' });
    } catch {
      // Redirect even when the session endpoint is temporarily unavailable;
      // the server-side page boundary remains the source of truth.
    } finally {
      router.replace('/');
    }
  };

  // Resume an intent only after workspace handoff is settled. A started job is
  // safe to revisit because the generation endpoint is idempotent by intent id.
  useEffect(() => {
    if (
      !resumeIntentId ||
      !resumeReady ||
      !resumeIntent ||
      !workspace?.hasWorkspace ||
      !resumeAllowed ||
      resumeStartedRef.current
    ) {
      return;
    }
    resumeStartedRef.current = true;
    if (resumeIntent.stage === 'generation_started' && resumeIntent.articleId) {
      router.push(`/articles/${resumeIntent.articleId}`);
      return;
    }
    if (resumeIntent.stage === 'editing' || !freshResumeRef.current) return;
    freshResumeRef.current = false;
    setResumeNeedsAction(false);
    const snapshot = {
      prompt: resumeIntent.prompt,
      slideCount: resumeIntent.slideCount,
      illustrationStyle: resumeIntent.illustrationStyle,
    };
    if (generationLocked) {
      pendingRetryRef.current = () => void runSubmit(snapshot);
      accessDialogSucceededRef.current = false;
      setShowAccessDialog(true);
      return;
    }
    void runSubmit(snapshot);
    // The ref guard makes this effect safe across StrictMode's development pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeIntentId, resumeReady, resumeIntent, workspace, resumeAllowed]);

  const handleResumeContinue = () => {
    if (!resumeIntent) return;
    const snapshot = snapshotForCurrentPrompt();
    if (!snapshot.prompt) {
      setComposerError(messages.dashboard.promptRequired);
      return;
    }
    if (snapshot.prompt.length < MINIMUM_PROMPT_LENGTH) {
      setComposerError(messages.publicHome.promptTooShort);
      return;
    }
    resumeStartedRef.current = true;
    setResumeNeedsAction(false);
    if (generationLocked) {
      pendingRetryRef.current = () => void runSubmit(snapshot);
      accessDialogSucceededRef.current = false;
      setShowAccessDialog(true);
      return;
    }
    void runSubmit(snapshot);
  };

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

  const helperText = composerError
    ? composerError
    : generationLocked
      ? messages.dashboard.generationLockedHint
      : prompt.trim()
        ? messages.dashboard.promptHintReady
        : messages.dashboard.promptHintEmpty;

  if ((isWorkspaceLoading && !workspace) || isWorkspaceBusy) {
    return (
      <WorkspaceBootstrapScreen
        title={messages.workspace.bootstrapLoadingTitle}
        description={messages.workspace.bootstrapLoadingDescription}
        status="Checking your account"
      >
        <Loader2 aria-hidden="true" className="size-5 animate-spin text-primary" />
      </WorkspaceBootstrapScreen>
    );
  }

  if (workspaceError && !workspace) {
    return (
      <WorkspaceBootstrapScreen
        title={messages.workspace.bootstrapErrorTitle}
        description={workspaceError.message || messages.workspace.bootstrapErrorDescription}
        status="Account connection unavailable"
        tone="error"
      >
        <Button type="button" className="w-fit" onClick={() => void refetchWorkspace()}>
          {messages.common.retry}
        </Button>
      </WorkspaceBootstrapScreen>
    );
  }

  if (provisioningError && (!workspace || !hasWorkspace)) {
    return (
      <WorkspaceBootstrapScreen
        title={messages.workspace.bootstrapErrorTitle}
        description={provisioningError}
        status="Account connection unavailable"
        tone="error"
      >
        <Button
          type="button"
          className="w-fit"
          onClick={() => {
            autoProvisionAttemptedRef.current = false;
            setProvisioningError(null);
            setProvisionAttempt((attempt) => attempt + 1);
          }}
        >
          {messages.common.retry}
        </Button>
      </WorkspaceBootstrapScreen>
    );
  }

  if (!workspace || !hasWorkspace) {
    if (resumeRequested && !resumeBypassed && !resumeIntent) {
      return (
        <WorkspaceBootstrapScreen
          title={resumeReady
            ? messages.publicHome.resumeUnavailable
            : messages.workspace.bootstrapLoadingTitle}
          description={resumeReady
            ? composerError ?? messages.publicHome.resumeUnavailable
            : messages.workspace.bootstrapLoadingDescription}
          status={resumeReady ? 'Draft unavailable' : 'Checking your account'}
          tone={resumeReady ? 'error' : 'default'}
        >
          {resumeReady ? (
            <Button type="button" onClick={handleUnavailableResumeContinue}>
              {messages.workspace.resumeChoiceContinue}
            </Button>
          ) : (
            <Loader2 aria-hidden="true" className="size-5 animate-spin text-primary" />
          )}
        </WorkspaceBootstrapScreen>
      );
    }
    // This is only a defensive fallback if provisioning is unavailable. The
    // normal account path above creates the workspace automatically.
    return <WorkspaceOnboarding notice={composerError} />;
  }

  // Every key exists in the catalog; the old cast-with-fallbacks predated
  // them and silently masked the real translations.
  const workspaceChoiceTitle = messages.workspace.resumeChoiceTitle;
  const workspaceChoiceDescription = messages.workspace.resumeChoiceDescription;
  const continueWorkspaceLabel = messages.workspace.resumeChoiceContinue;
  const importWorkspaceLabel = messages.workspace.resumeChoiceImport;
  const resumeContinueLabel = messages.workspace.resumeContinue;
  const resumeContinueDescription = messages.workspace.resumeContinueDescription;

  return (
    <>
      <ArticleStudioShell
        mode="workspace"
        headerTitle={messages.dashboard.headerTitle}
        sidebar={(
          <DeckSidebarList
            decks={filteredDecks}
            isLoading={isLoading}
            isError={isError}
            query={query}
            onQueryChange={setQuery}
            language={language}
          />
        )}
        sidebarFooter={(
          <WorkspaceSidebarFooter
            showRecovery={false}
            accountLabel={accountLabel}
            accountEmail={actor?.email}
            settingsLabel={messages.dashboard.settings}
            onOpenSettings={handleOpenConnections}
            {...(workspace.canReplaceWithLegacy
              ? {
                  importOldWorkspaceLabel: messages.dashboard.importOldWorkspace,
                  onImportOldWorkspace: handleSidebarImport,
                }
              : {})}
            signOutLabel={messages.dashboard.signOut}
            signingOutLabel={messages.dashboard.signingOut}
            isSigningOut={isSigningOut}
            onSignOut={handleSignOut}
          />
        )}
        mainClassName="studio-main-workspace"
      >
        <section className="studio-home-canvas flex min-h-full w-full flex-col justify-start gap-6 py-6 sm:py-8">
          <div className="studio-intro min-w-0 text-center">
            <h1 className="mx-auto max-w-[24ch] text-balance text-3xl font-semibold leading-[1.08] tracking-normal text-foreground sm:text-4xl lg:text-[2.65rem]">
              {messages.dashboard.promptHomeTitle}
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {messages.dashboard.promptHomeSubtitle}
            </p>
          </div>

          <div data-article-studio-composer className="mx-auto w-full max-w-3xl space-y-3">
            {resumeNeedsAction ? (
              <div className="flex flex-col gap-3 rounded-xl border border-[var(--signal)]/40 bg-[var(--signal-soft)]/35 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm leading-relaxed text-muted-foreground">{resumeContinueDescription}</p>
                <Button type="button" size="sm" className="h-9 shrink-0 rounded-lg" onClick={handleResumeContinue}>
                  {resumeContinueLabel}
                </Button>
              </div>
            ) : null}
            <PromptComposer
              prompt={prompt}
              onPromptChange={(value) => {
                setPrompt(value);
                if (composerError) setComposerError(null);
              }}
              slideCount={slideCount}
              onSlideCountChange={setSlideCount}
              illustrationStyle={illustrationStyle}
              onIllustrationStyleChange={setIllustrationStyle}
              onGenerate={handleSubmit}
              onSuggest={handleSuggest}
              showSuggest
              isGenerating={isSubmitting}
              isSuggesting={isSuggesting}
              labels={{
                prompt: (messages.dashboard as typeof messages.dashboard & { promptLabel?: string }).promptLabel
                  ?? messages.dashboard.promptHomeTitle,
                placeholder: messages.dashboard.promptPlaceholder,
                slideCount: messages.dashboard.slideCountLabel,
                illustrationStyle: messages.dashboard.illustrationStyleLabel,
                generate: messages.dashboard.generateAction,
                generating: messages.dashboard.generateLoading,
                suggest: messages.dashboard.aiSuggest,
                suggesting: messages.dashboard.aiSuggestLoading,
              }}
              helperText={helperText}
              error={composerError}
            />
          </div>
        </section>
      </ArticleStudioShell>

      <ConnectionsDialog
        open={settingsOpen}
        onOpenChange={handleConnectionsOpenChange}
        canManageAi={workspace.workspaceRole === 'owner'}
        canManageAccess={canManageAccess}
      />

      {workspaceChoiceOpen ? (
        <AlertDialog open onOpenChange={handleWorkspaceChoiceOpenChange}>
          <AlertDialogContent
            className="console-dialog border-dotted p-4 sm:p-5"
            onEscapeKeyDown={(event) => event.preventDefault()}
          >
            <FrameCornerHandles />
            <AlertDialogHeader>
              <AlertDialogTitle className="text-base sm:text-lg">{workspaceChoiceTitle}</AlertDialogTitle>
              <AlertDialogDescription className="text-xs leading-relaxed sm:text-sm">{workspaceChoiceDescription}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
              <AlertDialogCancel className="h-10 rounded-lg" onClick={handleImportOldWorkspace}>
                {importWorkspaceLabel}
              </AlertDialogCancel>
              <AlertDialogAction className="h-10 rounded-lg" onClick={handleContinueWithNewWorkspace}>
                {continueWorkspaceLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {recoverWorkspaceOpen ? (
        <RecoverWorkspaceDialog
          open={recoverWorkspaceOpen}
          onOpenChange={handleRecoverWorkspaceOpenChange}
          onSuccess={handleWorkspaceRecovered}
        />
      ) : null}

      <GenerateAccessDialog
        open={showAccessDialog}
        onOpenChange={handleAccessDialogChange}
        onSuccess={handleAccessSuccess}
      />
    </>
  );
}
