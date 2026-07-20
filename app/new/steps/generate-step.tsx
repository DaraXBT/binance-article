'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { GenerateAccessDialog } from '@/components/generate-access-dialog';
import { useLanguage } from '@/components/language-provider';
import { GenerateAccessError } from '@/lib/generate-access-error';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Circle, Loader2, Lock } from 'lucide-react';
import { JobSummary } from '@/lib/schemas';

interface GenerateStepProps {
  formData: {
    title: string;
    articleContent: string;
    slideCount: number;
    illustrationStyle: string;
  };
  mode: 'text' | 'url' | 'prompt';
  generationLocked?: boolean;
  onUnlock?: () => void;
  onGenerationAccessLost?: () => void;
}

type Phase = 'idle' | 'awaiting-code' | 'creating' | 'generating-slides' | 'generating-images' | 'generating-captions' | 'complete' | 'error';

interface PhaseInfo {
  id: Phase;
  label: string;
  detail?: string;
}

type ImageErrorSummaryType = 'quota_exceeded' | 'configuration' | 'mixed' | 'unknown';

interface ImageErrorSummary {
  type: ImageErrorSummaryType;
  message: string;
  providerCode?: number;
  providerStatus?: string;
  retryAfterSeconds?: number;
  model?: string;
}

interface ImageGenerationSummary {
  status: 'success' | 'partial' | 'failed';
  generated: number;
  failed: number;
  total: number;
  errorSummary?: ImageErrorSummary;
}

async function waitForJob(jobId: string, onProgress: (job: JobSummary) => void) {
  const maxAttempts = 90;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(`/api/jobs/${jobId}`, {
      cache: 'no-store',
    });
    const job = (await response.json()) as JobSummary & { error?: string };

    if (!response.ok) {
      throw new Error(job.error || 'Failed to fetch job status');
    }

    onProgress(job);

    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error('Timed out while waiting for generation to finish.');
}

function extractTitleFromContent(content: string): string {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim().slice(0, 80);
  const firstLine = content.split('\n').find((line) => line.trim().length > 0);
  return firstLine ? firstLine.trim().slice(0, 80) : 'Untitled';
}

export function GenerateStep({
  formData,
  mode,
  generationLocked = false,
  onUnlock,
  onGenerationAccessLost,
}: GenerateStepProps) {
  const router = useRouter();
  const { messages } = useLanguage();
  const [phase, setPhase] = useState<Phase>(generationLocked ? 'awaiting-code' : 'idle');
  const [error, setError] = useState('');
  const [imageProgress, setImageProgress] = useState({ current: 0, total: 0 });
  const [imageSummary, setImageSummary] = useState<ImageGenerationSummary | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [showAccessDialog, setShowAccessDialog] = useState(false);

  const phases: PhaseInfo[] = [
    { id: 'creating', label: messages.newDeck.generateView.creatingDeck },
    { id: 'generating-slides', label: messages.newDeck.generateView.generatingSlideContent },
    {
      id: 'generating-images',
      label: messages.newDeck.generateView.generatingImages,
      detail: imageProgress.total > 0 ? `${imageProgress.current}/${imageProgress.total}` : undefined,
    },
    { id: 'generating-captions', label: messages.newDeck.generateView.generatingBlogAndX },
  ];

  const phaseOrder = ['idle', 'creating', 'generating-slides', 'generating-images', 'generating-captions', 'complete'];

  const isPhaseComplete = (phaseId: Phase) => {
    const currentIdx = phaseOrder.indexOf(phase);
    const phaseIdx = phaseOrder.indexOf(phaseId);
    return currentIdx > phaseIdx;
  };

  const isPhaseActive = (phaseId: Phase) => phase === phaseId;
  const quotaErrorSummary = imageSummary?.errorSummary?.type === 'quota_exceeded'
    ? imageSummary.errorSummary
    : null;

  const handleGenerate = useCallback(async () => {
    try {
      if (generationLocked) {
        setPhase('awaiting-code');
        return;
      }

      setPhase('creating');
      setError('');
      setImageSummary(null);
      setJobProgress(0);

      // Step 1: Create deck
      const createRes = await fetch('/api/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: mode === 'url' ? 'Import from URL' : (formData.title.trim() || extractTitleFromContent(formData.articleContent)),
          description: mode === 'url' ? formData.title : formData.articleContent.slice(0, 200),
          content: mode === 'url' ? formData.title : formData.articleContent,
          illustrationStyle: formData.illustrationStyle,
        }),
      });

      if (!createRes.ok) {
        const errorData = await createRes.json().catch(() => null);
        if (GenerateAccessError.isGenerateAccessResponse(createRes.status, errorData)) {
          onGenerationAccessLost?.();
          setShowAccessDialog(true);
          setPhase('awaiting-code');
          return;
        }
        throw new Error(errorData?.error || messages.newDeck.generateView.createDeckError);
      }
      const deckData = await createRes.json();
      const newDeckId = deckData.id;

      // Step 2: Start the generation workflow
      setPhase('generating-slides');
      const generateRes = await fetch(`/api/articles/${newDeckId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleContent: mode === 'url' ? formData.title : formData.articleContent, // Passing URL or Prompt down
          slideCount: formData.slideCount,
          illustrationStyle: formData.illustrationStyle,
          mode: mode, // Tell the backend what mode we are performing
        }),
      });

      if (!generateRes.ok) {
        const errorData = await generateRes.json().catch(() => null);
        if (GenerateAccessError.isGenerateAccessResponse(generateRes.status, errorData)) {
          onGenerationAccessLost?.();
          setShowAccessDialog(true);
          setPhase('awaiting-code');
          return;
        }
        throw new Error(errorData?.error || messages.newDeck.generateView.generateSlidesError);
      }

      const generationStart = await generateRes.json();
      const finalJob = await waitForJob(generationStart.jobId, (job) => {
        setJobProgress(job.progress);

        if (job.progress >= 95) {
          setPhase('generating-captions');
          return;
        }

        if (job.progress >= 55) {
          setPhase('generating-images');
          return;
        }

        setPhase('generating-slides');
      });

      if (finalJob.status !== 'completed') {
        throw new Error(finalJob.error || messages.newDeck.generateView.generateSlidesError);
      }

      const jobResult = (finalJob.result ?? null) as
        | {
            slideCount?: number;
            imageSummary?: ImageGenerationSummary;
          }
        | null;

      const resolvedImageSummary = jobResult?.imageSummary ?? null;
      setImageSummary(resolvedImageSummary);
      setImageProgress({
        current:
          (resolvedImageSummary?.generated || 0) + (resolvedImageSummary?.failed || 0),
        total: resolvedImageSummary?.total || jobResult?.slideCount || formData.slideCount,
      });

      setPhase('complete');

      // Redirect after a short delay
      setTimeout(() => {
        router.push(`/articles/${newDeckId}`);
      }, 1500);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : messages.newDeck.generateView.unknownError;

      setPhase('error');
      setError(message);
    }
  }, [formData, generationLocked, messages, mode, onGenerationAccessLost, router]);

  useEffect(() => {
    if (phase === 'idle') {
      void handleGenerate();
    }
  }, [handleGenerate, phase]);

  useEffect(() => {
    if (generationLocked) {
      setPhase((current) => (current === 'complete' ? current : 'awaiting-code'));
      return;
    }

    setPhase((current) => (current === 'awaiting-code' ? 'idle' : current));
  }, [generationLocked]);

  const progress = (() => {
    if (phase === 'generating-slides' || phase === 'generating-images' || phase === 'generating-captions') {
      return Math.max(jobProgress, phase === 'generating-slides' ? 20 : phase === 'generating-images' ? 60 : 90);
    }

    switch (phase) {
      case 'creating': return 10;
      case 'complete': return 100;
      default: return 0;
    }
  })();

  const hasImageWarnings = imageSummary?.status === 'partial' || imageSummary?.status === 'failed';

  return (
    <>
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-2">
          {phase === 'complete'
            ? messages.newDeck.generateView.deckReady
            : phase === 'awaiting-code'
              ? messages.newDeck.generateView.generationLockedTitle
            : messages.newDeck.generateView.generatingDeck}
        </h2>
        <p className="text-muted-foreground">
          {phase === 'complete'
            ? hasImageWarnings
              ? messages.newDeck.generateView.readyWithWarningsDescription
              : messages.newDeck.generateView.readyDescription
            : phase === 'awaiting-code'
              ? messages.newDeck.generateView.generationLockedDescription
            : messages.newDeck.generateView.workingDescription}
        </p>
      </div>

      {phase === 'awaiting-code' ? (
        <div className="space-y-4">
          <div className="border border-dotted border-[var(--access-signal)]/45 bg-[var(--access-signal)]/5 p-4 text-foreground">
            <div className="flex items-start gap-3">
              <Lock className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="text-sm font-medium">
                  {messages.newDeck.generateView.generationLockedTitle}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {messages.newDeck.generateView.generationLockedDescription}
                </p>
              </div>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => setShowAccessDialog(true)}
            variant="outline"
            size="sm"
            className="gap-2 rounded-none border-dotted"
          >
            <Lock className="h-4 w-4" />
            {messages.generateAccess.submit}
          </Button>
        </div>
      ) : phase === 'error' ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 border border-dotted border-destructive/30 bg-destructive/10 p-4">
            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive mb-1">
                {messages.newDeck.generateView.generationFailed}
              </p>
              <p className="text-sm text-destructive/80">{error}</p>
            </div>
          </div>
          <Button onClick={handleGenerate} variant="outline" size="sm" className="gap-2 rounded-none border-dotted">
            {messages.newDeck.generateView.tryAgain}
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{messages.newDeck.generateView.progress}</p>
              <p className="text-sm text-muted-foreground tabular-nums">{progress}%</p>
            </div>
            <div className="h-2.5 w-full overflow-hidden border border-dotted border-border bg-secondary/50">
              <div
                className="h-full bg-primary transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="space-y-3">
            {phases.map((p) => (
              <div key={p.id} className="flex items-center gap-3 text-sm">
                <div className="flex-shrink-0">
                  {isPhaseComplete(p.id) ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  ) : isPhaseActive(p.id) ? (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground/30" />
                  )}
                </div>
                <span className={
                  isPhaseComplete(p.id) ? 'text-emerald-600 dark:text-emerald-400 font-medium' :
                  isPhaseActive(p.id) ? 'text-primary font-medium' :
                  'text-muted-foreground'
                }>
                  {p.label}
                </span>
                {p.detail && isPhaseActive(p.id) && (
                  <span className="border border-dotted border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                    {p.detail}
                  </span>
                )}
              </div>
            ))}
          </div>

          {phase === 'complete' && (
            <div
              className={`border border-dotted p-4 ${
                hasImageWarnings
                  ? 'bg-destructive/10 border-destructive/30'
                  : 'bg-primary/10 border-primary/30'
              }`}
            >
              <p
                className={`text-sm font-medium ${
                  hasImageWarnings ? 'text-destructive' : 'text-primary'
                }`}
              >
                {hasImageWarnings
                  ? quotaErrorSummary
                    ? messages.newDeck.generateView.quotaWarningTitle
                    : messages.newDeck.generateView.generationCompletedWithWarnings
                  : messages.newDeck.generateView.successSummary(formData.slideCount)}
              </p>
              {hasImageWarnings && imageSummary ? (
                quotaErrorSummary ? (
                  <div className="mt-1 space-y-1 text-sm text-destructive/80">
                    <p>{messages.newDeck.generateView.quotaWarningBody(imageSummary.failed)}</p>
                    {quotaErrorSummary.retryAfterSeconds ? (
                      <p>{messages.newDeck.generateView.quotaWarningRetryAfter(quotaErrorSummary.retryAfterSeconds)}</p>
                    ) : null}
                    {quotaErrorSummary.model ? (
                      <p>{messages.newDeck.generateView.quotaWarningModel(quotaErrorSummary.model)}</p>
                    ) : null}
                    <p>{messages.newDeck.generateView.quotaWarningAction}</p>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-destructive/80">
                    {imageSummary.status === 'failed'
                      ? messages.newDeck.generateView.failedImageSummary(imageSummary.failed)
                      : messages.newDeck.generateView.partialImageSummary(
                          imageSummary.generated,
                          imageSummary.failed
                        )}
                  </p>
                )
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
      <GenerateAccessDialog
        open={showAccessDialog}
        onOpenChange={setShowAccessDialog}
        onSuccess={() => {
          onUnlock?.();
          setShowAccessDialog(false);
          setPhase('idle');
        }}
      />
    </>
  );
}
