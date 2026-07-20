'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import {
  FileText,
  Layers3,
  Lightbulb,
  LogIn,
  MessageSquarePlus,
} from 'lucide-react';

import { LanguageToggle } from '@/components/language-toggle';
import { useLanguage } from '@/components/language-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { SidebarContent } from '@/components/ui/sidebar';
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
  ConsolePanel,
  type ConsoleStatusItem,
} from '@/components/console/secure-console-frame';
import type { IllustrationStyleId } from '@/lib/config';
import {
  AnonymousDraftStorageError,
  createAnonymousGenerationIntent,
  loadAnonymousGenerationIntent,
  removeAnonymousGenerationIntent,
  saveAnonymousGenerationIntent,
  updateAnonymousGenerationIntent,
  type AnonymousGenerationIntent,
} from '@/lib/client/anonymous-draft';
import {
  ArticleStudioShell,
  ArticleStudioStatusStrip,
} from './article-studio-shell';
import { PromptComposer, type ComposerSlideCount } from './prompt-composer';

function getDraftTitle(prompt: string, fallback: string) {
  const firstLine = prompt
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean);

  return (firstLine || fallback).slice(0, 52);
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
  const [illustrationStyle, setIllustrationStyle] = useState<IllustrationStyleId>('lab-notes');
  const [error, setError] = useState<string | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resumeIntentId, setResumeIntentId] = useState<string | null>(null);
  const intentRef = useRef<AnonymousGenerationIntent | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const submissionStartedRef = useRef(false);
  const hasUserEditedRef = useRef(false);
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

  const handleCreate = () => {
    if (isSubmitting) return;
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt.length < 10) {
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
      setResumeIntentId(submitted.intentId);
      setError(null);
      setStorageFailed(false);
      const destination = `/workspace?resume=${submitted.intentId}`;
      if (onNavigate) onNavigate(destination);
      else window.location.assign(destination);
    } catch (storageError) {
      submissionStartedRef.current = false;
      setIsSubmitting(false);
      setStorageFailed(true);
      setError(
        storageError instanceof AnonymousDraftStorageError
          ? copy.storageError
          : copy.storageError,
      );
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

  const handleHeaderSignIn = (event: MouseEvent<HTMLAnchorElement>) => {
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
    promptRef.current?.focus();
    window.setTimeout(() => promptRef.current?.focus(), 0);
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

  const styleNames = {
    'pixel-art': messages.newDeck.styleOptions['pixel-art'].name,
    'fantasy-animation': messages.newDeck.styleOptions['fantasy-animation'].name,
    'lab-notes': messages.newDeck.styleOptions['lab-notes'].name,
  };

  const statuses: ConsoleStatusItem[] = [
    { label: 'Draft', value: prompt.trim() ? (resumeIntentId ? 'HELD' : 'LOCAL') : 'EMPTY' },
    { label: 'Identity', value: 'REQUIRED', tone: 'warning' },
    { label: 'Generation', value: 'LOCKED', tone: 'warning' },
  ];

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
          <SidebarContent className="min-h-0 px-2 py-2">
            <nav
              aria-label={copy.studioTitle}
              data-article-studio-rail="anonymous"
              className="flex min-h-full flex-col"
            >
            <div className="border-b border-dotted border-sidebar-border/80 px-1 pb-3">
              <Link href="/" className="flex min-w-0 items-center gap-2.5 px-1 py-1.5">
                <span className="flex size-8 shrink-0 items-center justify-center border border-sidebar-foreground/70 bg-sidebar-foreground text-sidebar">
                  <Layers3 aria-hidden="true" className="size-4" />
                </span>
                <span className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
                  xArticle
                </span>
              </Link>
              <Button
                type="button"
                onClick={handleNewArticle}
                className="mt-2 h-9 w-full justify-start rounded-none border border-sidebar-primary/45 bg-sidebar-primary text-sidebar-primary-foreground hover:brightness-110"
              >
                <MessageSquarePlus aria-hidden="true" className="size-4" />
                {copy.newArticle}
              </Button>
            </div>

            <div className="mt-3 min-w-0">
              <p className="px-1 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-sidebar-foreground/60">
                {copy.localDraft}
              </p>
              {prompt.trim() ? (
                <button
                  type="button"
                  onClick={focusPrompt}
                  aria-label={`${copy.localDraft}: ${getDraftTitle(prompt, copy.untitledArticle)}`}
                  className="mt-1 flex w-full min-w-0 items-start gap-2 border border-dotted border-sidebar-border/80 bg-sidebar-accent/30 px-2.5 py-2.5 text-left text-sidebar-foreground transition-colors hover:border-sidebar-primary/50 hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50"
                >
                  <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sidebar-foreground/65" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {getDraftTitle(prompt, copy.untitledArticle)}
                    </span>
                    <span className="mt-1 block font-mono text-[0.58rem] uppercase tracking-[0.12em] text-sidebar-foreground/60">
                      {intentRef.current?.stage === 'submitted'
                        ? copy.draftStateReady
                        : resumeIntentId
                          ? copy.draftStateHeld
                          : copy.draftStateLocal}
                    </span>
                  </span>
                </button>
              ) : (
                <p className="mt-1 border border-dotted border-sidebar-border/70 px-2.5 py-2.5 text-xs leading-relaxed text-sidebar-foreground/55">
                  {copy.noLocalDraft}
                </p>
              )}
            </div>

            <div className="mt-5 min-w-0">
              <p className="flex items-center gap-1.5 px-1 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-sidebar-foreground/60">
                <Lightbulb aria-hidden="true" className="size-3.5" />
                {copy.startersLabel}
              </p>
              <div className="mt-1.5 grid gap-1">
                {copy.starters.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => handleStarterSelect(starter)}
                    className="min-w-0 border border-transparent px-2.5 py-2 text-left text-xs leading-relaxed text-sidebar-foreground/70 transition-colors hover:border-dotted hover:border-sidebar-border/80 hover:bg-sidebar-accent/45 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50"
                  >
                    <span className="line-clamp-2">{starter}</span>
                  </button>
                ))}
              </div>
            </div>
            </nav>
          </SidebarContent>
        )}
        sidebarFooter={(
          <div className="space-y-2 p-1">
            <Link
              href={signInHref}
              onClick={handleHeaderSignIn}
              aria-label={copy.signIn}
              className="flex h-9 w-full items-center justify-start gap-2 border border-sidebar-border/80 bg-sidebar-accent/30 px-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:border-sidebar-primary/50 hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50"
            >
              <LogIn aria-hidden="true" className="size-4" />
              {copy.signIn}
            </Link>
            <p className="px-1 font-mono text-[0.58rem] uppercase tracking-[0.11em] text-sidebar-foreground/55">
              {copy.savedInTab}
            </p>
          </div>
        )}
        headerActions={(
          <>
            <span className="mr-1 hidden max-w-48 truncate border-r border-border/70 pr-3 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted-foreground sm:inline">
              {copy.privateBeta}
            </span>
            <LanguageToggle />
            <ThemeToggle />
            <Button asChild size="sm" className="h-8 rounded-none px-2 min-[390px]:px-3">
              <Link href={signInHref} onClick={handleHeaderSignIn} aria-label={copy.signIn}>
                <LogIn aria-hidden="true" className="size-4 min-[390px]:hidden" />
                <span className="hidden min-[390px]:inline">{copy.signIn}</span>
              </Link>
            </Button>
          </>
        )}
        footer={(
          <>
            <span className="truncate">{copy.trustLine}</span>
            <span className="hidden shrink-0 font-mono uppercase tracking-[0.1em] sm:inline">
              {copy.privateAssets}
            </span>
          </>
        )}
        mainClassName="studio-main-public"
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center gap-4">
          <section className="min-w-0 text-center">
            <p className="mb-2 font-mono text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-primary">
              {copy.eyebrow}
            </p>
            <h1 className="text-2xl font-semibold leading-tight tracking-normal sm:text-3xl">
              {copy.title}
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {copy.subtitle}
            </p>
          </section>

          <ArticleStudioStatusStrip items={statuses} />

          <div data-article-studio-composer>
            <ConsolePanel className="studio-composer-panel bg-card/70 p-3 sm:p-5">
            <div id="public-composer" className="scroll-mt-4">
              <div className="mb-3 flex items-center justify-between gap-3 border-b border-dotted border-border/70 px-1 pb-2.5">
                <span className="truncate font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-foreground">
                  {copy.promptLabel}
                </span>
                <span className="shrink-0 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted-foreground/75">
                  {copy.privateAssets}
                </span>
              </div>
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
                  styleNames,
                }}
                helperText={copy.accessHint}
                error={error}
                isGenerating={isSubmitting}
              />

              {storageFailed ? (
                <div className="mt-3 flex flex-wrap items-center justify-end gap-3 border-t border-dotted border-border/70 pt-3 text-sm">
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
            </ConsolePanel>
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
            <AlertDialogCancel className="h-10 rounded-none border-dotted">
              {copy.keepDraft}
            </AlertDialogCancel>
            <AlertDialogAction className="h-10 rounded-none" onClick={handleDiscardDraft}>
              {copy.discardDraft}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
