'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import {
  FileText,
  Lightbulb,
  LogIn,
  MessageSquarePlus,
} from 'lucide-react';

import { useLanguage } from '@/components/language-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { SidebarContent, useSidebar } from '@/components/ui/sidebar';
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
import {
  DEFAULT_ILLUSTRATION_STYLE,
  type IllustrationStyleId,
} from '@/lib/config';
import {
  createAnonymousGenerationIntent,
  loadAnonymousGenerationIntent,
  removeAnonymousGenerationIntent,
  saveAnonymousGenerationIntent,
  updateAnonymousGenerationIntent,
  type AnonymousGenerationIntent,
} from '@/lib/client/anonymous-draft';
import {
  ArticleStudioShell,
} from './article-studio-shell';
import { MINIMUM_PROMPT_LENGTH, PromptComposer, type ComposerSlideCount } from './prompt-composer';
import { StudioSidebarBrand } from './studio-sidebar-brand';

function getDraftTitle(prompt: string, fallback: string) {
  const firstLine = prompt
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean);

  return (firstLine || fallback).slice(0, 52);
}

type AnonymousRailCopy = {
  studioTitle: string;
  newArticle: string;
  localDraft: string;
  untitledArticle: string;
  noLocalDraft: string;
  draftStateLocal: string;
  draftStateHeld: string;
  draftStateReady: string;
  startersLabel: string;
  starters: readonly string[];
  signIn: string;
};

function AnonymousStudioRail({
  copy,
  prompt,
  resumeIntent,
  onNewArticle,
  onStarterSelect,
  onFocusPrompt,
  onPrepareMobileCloseFocus,
}: {
  copy: AnonymousRailCopy;
  prompt: string;
  resumeIntent: AnonymousGenerationIntent | null;
  onNewArticle: () => void;
  onStarterSelect: (starter: string) => void;
  onFocusPrompt: () => void;
  onPrepareMobileCloseFocus: () => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();

  const handleStarter = (starter: string) => {
    onStarterSelect(starter);
    if (isMobile) {
      onPrepareMobileCloseFocus();
      setOpenMobile(false);
    }
  };

  return (
    <SidebarContent className="min-h-0 px-2 py-2">
      <nav
        aria-label={copy.studioTitle}
        data-article-studio-rail="anonymous"
        className="flex min-h-full flex-col"
      >
        <div className="border-b border-dotted border-sidebar-border/80 px-1 pb-3 group-data-[collapsible=icon]:border-b-0 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:pb-0">
          <StudioSidebarBrand
            href="/"
            openLabel="Open article navigation"
            closeLabel="Close article navigation"
          />
          <Button
            type="button"
            onClick={onNewArticle}
            aria-label={copy.newArticle}
            title={copy.newArticle}
            className="mt-2 h-9 w-full justify-start rounded-lg group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
          >
            <MessageSquarePlus aria-hidden="true" className="size-4" />
            <span className="group-data-[collapsible=icon]:hidden">{copy.newArticle}</span>
          </Button>
        </div>

        <div className="mt-3 min-w-0 group-data-[collapsible=icon]:hidden">
          <p className="px-1 text-xs font-medium text-sidebar-foreground/65">
            {copy.localDraft}
          </p>
          {prompt.trim() ? (
            <button
              type="button"
              onClick={onFocusPrompt}
              aria-label={`${copy.localDraft}: ${getDraftTitle(prompt, copy.untitledArticle)}`}
              className="mt-1 flex w-full min-w-0 items-start gap-2 rounded-lg border border-sidebar-border/70 bg-sidebar-accent/30 px-2.5 py-2.5 text-left text-sidebar-foreground transition-colors hover:border-sidebar-primary/50 hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50"
            >
              <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sidebar-foreground/65" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {getDraftTitle(prompt, copy.untitledArticle)}
                </span>
                <span className="mt-1 block text-[0.68rem] font-medium text-sidebar-foreground/60">
                  {resumeIntent?.stage === 'submitted'
                    ? copy.draftStateReady
                    : resumeIntent
                      ? copy.draftStateHeld
                      : copy.draftStateLocal}
                </span>
              </span>
            </button>
          ) : (
            <p className="mt-1 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/20 px-2.5 py-2.5 text-xs leading-relaxed text-sidebar-foreground/65">
              {copy.noLocalDraft}
            </p>
          )}
        </div>

        <div className="mt-5 min-w-0 group-data-[collapsible=icon]:hidden">
          <p className="flex items-center gap-1.5 px-1 text-xs font-medium text-sidebar-foreground/65">
            <Lightbulb aria-hidden="true" className="size-3.5" />
            {copy.startersLabel}
          </p>
          <div className="mt-1.5 grid gap-1">
            {copy.starters.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => handleStarter(starter)}
                className="min-w-0 rounded-lg px-2.5 py-2 text-left text-xs leading-relaxed text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/45 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50"
              >
                <span className="line-clamp-2">{starter}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>
    </SidebarContent>
  );
}

export function PublicHome({
  onNavigate,
  storage,
}: {
  onNavigate?: (href: string) => void;
  storage?: Storage;
}) {
  const { messages } = useLanguage();
  const copy = messages.publicHome;
  const [prompt, setPrompt] = useState('');
  const [slideCount, setSlideCount] = useState<ComposerSlideCount>(5);
  const [illustrationStyle, setIllustrationStyle] = useState<IllustrationStyleId>(
    DEFAULT_ILLUSTRATION_STYLE,
  );
  const [error, setError] = useState<string | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resumeIntentId, setResumeIntentId] = useState<string | null>(null);
  const [resumeIntent, setResumeIntent] = useState<AnonymousGenerationIntent | null>(null);
  const intentRef = useRef<AnonymousGenerationIntent | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const submissionStartedRef = useRef(false);
  const hasUserEditedRef = useRef(false);
  const focusPromptOnMobileCloseRef = useRef(false);
  const focusRetryTimerRef = useRef<number | null>(null);
  const [isDiscardDialogOpen, setIsDiscardDialogOpen] = useState(false);

  const getStorage = useCallback(
    () => storage ?? window.sessionStorage,
    [storage],
  );

  useEffect(() => {
    try {
      const existing = loadAnonymousGenerationIntent(getStorage());
      if (!existing || (existing.stage !== 'editing' && existing.stage !== 'submitted')) return;
      intentRef.current = existing;
      setResumeIntent(existing);
      setResumeIntentId(existing.intentId);
      setPrompt(existing.prompt);
      setSlideCount(existing.slideCount);
      setIllustrationStyle(existing.illustrationStyle);
    } catch {
      // Storage may be unavailable in hardened browsing modes. Typing remains usable.
    }
  }, [getStorage]);

  useEffect(() => {
    if (!hasUserEditedRef.current || !prompt.trim()) return;
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    const promptAtSchedule = prompt;
    const slideCountAtSchedule = slideCount;
    const styleAtSchedule = illustrationStyle;
    const timeout = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      // A submit synchronously claims the intent. A delayed autosave from
      // before that click must never regress `submitted` back to `editing`.
      if (submissionStartedRef.current) return;
      try {
        const existing = intentRef.current;
        const next = existing
          ? updateAnonymousGenerationIntent(getStorage(), existing, {
              stage: 'editing',
              prompt: promptAtSchedule,
              slideCount: slideCountAtSchedule,
              illustrationStyle: styleAtSchedule,
            })
          : createAnonymousGenerationIntent({
              prompt: promptAtSchedule,
              slideCount: slideCountAtSchedule,
              illustrationStyle: styleAtSchedule,
            });
        if (!existing) saveAnonymousGenerationIntent(getStorage(), next);
        intentRef.current = next;
        setResumeIntent(next);
        setResumeIntentId(next.intentId);
        hasUserEditedRef.current = false;
      } catch {
        // Submission reports storage failure explicitly; background autosave stays quiet.
      }
    }, 250);
    autosaveTimerRef.current = timeout;
    return () => {
      window.clearTimeout(timeout);
      if (autosaveTimerRef.current === timeout) autosaveTimerRef.current = null;
    };
  }, [getStorage, illustrationStyle, prompt, slideCount]);

  useEffect(() => {
    return () => {
      // A mobile sheet can finish its close animation after this controller
      // unmounts (for example during route changes or test cleanup). Clear
      // any pending focus retry so it cannot outlive the page.
      const timer = focusRetryTimerRef.current;
      focusRetryTimerRef.current = null;
      if (timer !== null && typeof window !== 'undefined') {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const handleCreate = () => {
    if (isSubmitting) return;
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt.length < MINIMUM_PROMPT_LENGTH) {
      setError(copy.promptTooShort);
      return;
    }

    submissionStartedRef.current = true;
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    setIsSubmitting(true);
    try {
      const existing = intentRef.current;
      const submitted = existing
        ? updateAnonymousGenerationIntent(getStorage(), existing, {
            stage: 'submitted',
            prompt: trimmedPrompt,
            slideCount,
            illustrationStyle,
          })
        : createAnonymousGenerationIntent({
            prompt: trimmedPrompt,
            slideCount,
            illustrationStyle,
            stage: 'submitted',
          });
      if (!existing) saveAnonymousGenerationIntent(getStorage(), submitted);
      intentRef.current = submitted;
      setResumeIntent(submitted);
      setResumeIntentId(submitted.intentId);
      setError(null);
      setStorageFailed(false);
      const destination = `/workspace?resume=${submitted.intentId}`;
      if (onNavigate) onNavigate(destination);
      else window.location.assign(destination);
    } catch {
      // Everything in the try block is draft-persistence work, so any
      // failure here is presented as a storage problem.
      submissionStartedRef.current = false;
      setIsSubmitting(false);
      setStorageFailed(true);
      setError(copy.storageError);
    }
  };

  const handleSignInWithoutDraft = () => {
    submissionStartedRef.current = true;
    try {
      removeAnonymousGenerationIntent(getStorage());
    } catch {
      // A denied storage area must not prevent a normal sign-in.
    }
    const destination = '/login?callbackURL=%2Fworkspace';
    if (onNavigate) onNavigate(destination);
    else window.location.assign(destination);
  };

  const handleSignIn = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!prompt.trim()) return;
    event.preventDefault();
    try {
      const existing = intentRef.current;
      const next = existing
        ? updateAnonymousGenerationIntent(getStorage(), existing, {
            stage: hasUserEditedRef.current ? 'editing' : existing.stage,
            prompt,
            slideCount,
            illustrationStyle,
          })
        : createAnonymousGenerationIntent({ prompt, slideCount, illustrationStyle });
      if (!existing) saveAnonymousGenerationIntent(getStorage(), next);
      intentRef.current = next;
      setResumeIntent(next);
      setResumeIntentId(next.intentId);
      hasUserEditedRef.current = false;
      const callback = `/workspace?resume=${encodeURIComponent(next.intentId)}`;
      const destination = `/login?callbackURL=${encodeURIComponent(callback)}`;
      if (onNavigate) onNavigate(destination);
      else window.location.assign(destination);
    } catch {
      setStorageFailed(true);
      setError(copy.storageError);
    }
  };

  const focusPrompt = () => {
    if (typeof window === 'undefined') return;

    if (focusRetryTimerRef.current !== null) {
      window.clearTimeout(focusRetryTimerRef.current);
      focusRetryTimerRef.current = null;
    }

    let attempts = 0;
    const focus = () => {
      if (typeof window === 'undefined') return;
      if (promptRef.current) {
        promptRef.current.focus();
        focusRetryTimerRef.current = null;
        return;
      }
      if (attempts < 20) {
        attempts += 1;
        focusRetryTimerRef.current = window.setTimeout(focus, 10);
      } else {
        focusRetryTimerRef.current = null;
      }
    };
    focus();
  };

  const handleMobileSidebarCloseAutoFocus = (event: Event) => {
    if (!focusPromptOnMobileCloseRef.current) return;
    event.preventDefault();
    focusPromptOnMobileCloseRef.current = false;
    focusPrompt();
  };

  const handleMobileSidebarClosed = () => {
    if (!focusPromptOnMobileCloseRef.current) return;
    focusPrompt();
  };

  const handleNewArticle = () => {
    if (prompt.trim() || intentRef.current) {
      setIsDiscardDialogOpen(true);
      return;
    }
    setError(null);
    focusPrompt();
  };

  const handleDiscardDraft = () => {
    try {
      removeAnonymousGenerationIntent(getStorage());
    } catch {
      setStorageFailed(true);
      setError(copy.storageError);
      return;
    }

    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    submissionStartedRef.current = false;
    hasUserEditedRef.current = false;
    intentRef.current = null;
    setResumeIntent(null);
    setResumeIntentId(null);
    setPrompt('');
    setError(null);
    setStorageFailed(false);
    setIsDiscardDialogOpen(false);
    focusPrompt();
  };

  const handleStarterSelect = (starter: string) => {
    hasUserEditedRef.current = true;
    setPrompt(starter);
    setError(null);
    focusPrompt();
  };

  const signInCallback = resumeIntentId
    ? `/workspace?resume=${encodeURIComponent(resumeIntentId)}`
    : '/workspace';
  const signInHref = `/login?callbackURL=${encodeURIComponent(signInCallback)}`;

  return (
    <>
      <a
        href="#public-composer"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:border focus:border-primary focus:bg-background focus:px-3 focus:py-2 focus:text-sm"
      >
        {copy.skipToComposer}
      </a>

      <ArticleStudioShell
        mode="public"
        headerTitle={copy.studioTitle}
        sidebar={(
          <AnonymousStudioRail
            copy={copy}
            prompt={prompt}
            resumeIntent={resumeIntent}
            onNewArticle={handleNewArticle}
            onStarterSelect={handleStarterSelect}
            onFocusPrompt={focusPrompt}
            onPrepareMobileCloseFocus={() => {
              focusPromptOnMobileCloseRef.current = true;
            }}
          />
        )}
        sidebarFooter={(
          <div className="space-y-2 p-1 group-data-[collapsible=icon]:p-0">
            <Link
              href={signInHref}
              onClick={handleSignIn}
              aria-label={copy.signIn}
              title={copy.signIn}
              className="flex h-9 w-full items-center justify-start gap-2 rounded-lg border border-sidebar-border/80 bg-sidebar-accent/30 px-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:border-sidebar-primary/50 hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
            >
              <LogIn aria-hidden="true" className="size-4" />
              <span className="group-data-[collapsible=icon]:hidden">{copy.signIn}</span>
            </Link>
            <div className="flex items-center justify-end gap-1.5 group-data-[collapsible=icon]:hidden">
              <ThemeToggle />
            </div>
          </div>
        )}
        onMobileSidebarClose={handleMobileSidebarClosed}
        onMobileSidebarCloseAutoFocus={handleMobileSidebarCloseAutoFocus}
        mainClassName="studio-main-public"
      >
        <div className="studio-home-canvas flex min-h-full w-full flex-col justify-center gap-6">
          <section className="studio-intro min-w-0 text-center">
            <h1 className="mx-auto max-w-[24ch] text-balance text-3xl font-semibold leading-[1.08] tracking-normal sm:text-4xl lg:text-[2.65rem]">
              {copy.studioGreeting || copy.title}
            </h1>
          </section>

          <div data-article-studio-composer className="mx-auto w-full max-w-3xl">
            <div id="public-composer" className="scroll-mt-4">
              <PromptComposer
                textareaRef={promptRef}
                prompt={prompt}
                onPromptChange={(value) => {
                  hasUserEditedRef.current = true;
                  setPrompt(value);
                  if (error) setError(null);
                }}
                slideCount={slideCount}
                onSlideCountChange={(value) => {
                  hasUserEditedRef.current = true;
                  setSlideCount(value);
                }}
                illustrationStyle={illustrationStyle}
                onIllustrationStyleChange={(value) => {
                  hasUserEditedRef.current = true;
                  setIllustrationStyle(value);
                }}
                onGenerate={handleCreate}
                labels={{
                  prompt: copy.promptLabel,
                  placeholder: copy.promptPlaceholder,
                  slideCount: copy.slideCountLabel,
                  illustrationStyle: copy.illustrationStyleLabel,
                  generate: copy.createAction,
                  generating: copy.createAction,
                }}
                error={error}
                isGenerating={isSubmitting}
              />

              {storageFailed ? (
                <div className="mt-3 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-border/70 bg-card/70 px-3 py-3 text-sm">
                  <button
                    type="button"
                    onClick={handleCreate}
                    className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    {copy.retryDraft}
                  </button>
                  <button
                    type="button"
                    onClick={handleSignInWithoutDraft}
                    className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    {copy.signInWithoutDraft}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </ArticleStudioShell>

      <AlertDialog open={isDiscardDialogOpen} onOpenChange={setIsDiscardDialogOpen}>
        <AlertDialogContent className="console-dialog border-dotted p-4 sm:p-5">
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.discardDraftTitle}</AlertDialogTitle>
            <AlertDialogDescription>{copy.discardDraftDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialogCancel className="h-10 rounded-lg">
              {copy.keepDraft}
            </AlertDialogCancel>
            <AlertDialogAction className="h-10 rounded-lg" onClick={handleDiscardDraft}>
              {copy.discardDraft}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
