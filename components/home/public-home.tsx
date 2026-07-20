'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { LogIn } from 'lucide-react';

import { LanguageToggle } from '@/components/language-toggle';
import { useLanguage } from '@/components/language-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  ConsoleHeader,
  SecureConsoleFrame,
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
import { PromptComposer, type ComposerSlideCount } from './prompt-composer';

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
  const autosaveTimerRef = useRef<number | null>(null);
  const submissionStartedRef = useRef(false);
  const hasUserEditedRef = useRef(false);

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
    { label: 'Workspace', value: 'PENDING' },
    { label: 'AI access', value: 'LOCKED', tone: 'warning' },
  ];

  return (
    <>
      <a
        href="#public-composer"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:border focus:border-primary focus:bg-background focus:px-3 focus:py-2 focus:text-sm"
      >
        {copy.skipToComposer}
      </a>
      <SecureConsoleFrame
        variant="public"
        eyebrow={copy.eyebrow}
        title={copy.title}
        subtitle={copy.subtitle}
        statuses={statuses}
        header={(
          <ConsoleHeader
            actions={(
              <>
                <span className="mr-1 hidden max-w-48 truncate border-r border-border/70 pr-3 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground sm:inline">
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
          />
        )}
        footer={(
          <>
            <span className="truncate">{copy.trustLine}</span>
            <span className="hidden shrink-0 font-mono uppercase tracking-[0.1em] sm:inline">{copy.localDraftHint}</span>
          </>
        )}
        panelClassName="px-3 py-3.5 sm:px-4 sm:py-4"
      >
        <div id="public-composer" className="scroll-mt-4">
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-border/70 px-1 pb-3">
            <span className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-foreground">
              {copy.promptLabel}
            </span>
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted-foreground">
              {copy.privateAssets}
            </span>
          </div>
          <PromptComposer
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
            helperText={`${copy.accessHint} ${copy.localDraftHint}`}
            error={error}
            isGenerating={isSubmitting}
          />

          {storageFailed ? (
            <div className="mt-3 flex flex-wrap items-center justify-end gap-3 border-t border-border/70 pt-3 text-sm">
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

          <div className="mt-4 border-t border-border/70 pt-3">
            <p className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {copy.startersLabel}
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {copy.starters.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => {
                    hasUserEditedRef.current = true;
                    setPrompt(starter);
                    setError(null);
                  }}
                  className="min-h-10 border border-dotted border-border/80 bg-background/35 px-2.5 py-2 text-left text-xs leading-relaxed text-muted-foreground transition-colors hover:border-primary/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        </div>
      </SecureConsoleFrame>
    </>
  );
}
