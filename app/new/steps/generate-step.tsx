'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Circle, Loader2, AlertCircle } from 'lucide-react';

interface GenerateStepProps {
  formData: {
    title: string;
    articleContent: string;
    slideCount: number;
    illustrationStyle: string;
  };
  mode: 'text' | 'url' | 'prompt';
  onDone: () => void;
}

type Phase = 'idle' | 'creating' | 'generating-slides' | 'generating-images' | 'generating-captions' | 'complete' | 'error';

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

export function GenerateStep({ formData, mode, onDone }: GenerateStepProps) {
  const router = useRouter();
  const { messages } = useLanguage();
  const [phase, setPhase] = useState<Phase>('idle');
  const [deckId, setDeckId] = useState('');
  const [error, setError] = useState('');
  const [imageProgress, setImageProgress] = useState({ current: 0, total: 0 });
  const [imageSummary, setImageSummary] = useState<ImageGenerationSummary | null>(null);

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
      setPhase('creating');
      setError('');
      setImageSummary(null);

      // Step 1: Create deck
      const createRes = await fetch('/api/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: mode === 'url' ? 'Import from URL' : formData.title, // Temporarily use a placeholder title for URL mode
          description: mode === 'url' ? formData.title : formData.articleContent.slice(0, 200), // formData.title temporarily holds the URL
          content: mode === 'url' ? formData.title : formData.articleContent,
          illustrationStyle: formData.illustrationStyle,
        }),
      });

      if (!createRes.ok) {
        const errorData = await createRes.json().catch(() => null);
        throw new Error(errorData?.error || messages.newDeck.generateView.createDeckError);
      }
      const deckData = await createRes.json();
      const newDeckId = deckData.id;
      setDeckId(newDeckId);

      // Step 2: Generate slides
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
        throw new Error(errorData?.error || messages.newDeck.generateView.generateSlidesError);
      }

      const genResult = await generateRes.json();

      // Step 3: Generate images
      setPhase('generating-images');
      setImageProgress({ current: 0, total: genResult.slideCount || formData.slideCount });

      const imageRes = await fetch(`/api/articles/${newDeckId}/generate-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          illustrationStyle: formData.illustrationStyle,
        }),
      });

      const fallbackTotal = genResult.slideCount || formData.slideCount;
      const imageData = await imageRes.json().catch(() => null) as ImageGenerationSummary | null;

      if (imageRes.ok && imageData) {
        setImageSummary(imageData);
        setImageProgress({
          current: (imageData.generated || 0) + (imageData.failed || 0),
          total: imageData.total || fallbackTotal,
        });
      } else {
        console.warn('Image generation had issues, continuing...');
        setImageSummary({
          status: 'failed',
          generated: 0,
          failed: fallbackTotal,
          total: fallbackTotal,
        });
        setImageProgress({ current: fallbackTotal, total: fallbackTotal });
      }

      // Step 4: Captions are already generated with slides
      setPhase('generating-captions');

      // Update deck status
      await fetch(`/api/articles/${newDeckId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: 'default' }),
      }).catch(() => {});

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
  }, [formData, messages, router]);

  useEffect(() => {
    if (phase === 'idle') {
      handleGenerate();
    }
  }, []);

  const progress = (() => {
    switch (phase) {
      case 'creating': return 10;
      case 'generating-slides': return 30;
      case 'generating-images': return 60;
      case 'generating-captions': return 85;
      case 'complete': return 100;
      default: return 0;
    }
  })();

  const hasImageWarnings = imageSummary?.status === 'partial' || imageSummary?.status === 'failed';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-2">
          {phase === 'complete'
            ? `🎉 ${messages.newDeck.generateView.deckReady}`
            : messages.newDeck.generateView.generatingDeck}
        </h2>
        <p className="text-muted-foreground">
          {phase === 'complete'
            ? hasImageWarnings
              ? messages.newDeck.generateView.readyWithWarningsDescription
              : messages.newDeck.generateView.readyDescription
            : messages.newDeck.generateView.workingDescription}
        </p>
      </div>

      {phase === 'error' ? (
        <div className="space-y-4">
          <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive mb-1">
                {messages.newDeck.generateView.generationFailed}
              </p>
              <p className="text-sm text-destructive/80">{error}</p>
            </div>
          </div>
          <Button onClick={handleGenerate} variant="outline" className="gap-2">
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
            <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700 ease-out rounded-full"
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
                    <Loader2 className="h-5 w-5 text-amber-500 animate-spin" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground/30" />
                  )}
                </div>
                <span className={
                  isPhaseComplete(p.id) ? 'text-emerald-600 dark:text-emerald-400 font-medium' :
                  isPhaseActive(p.id) ? 'text-amber-600 dark:text-amber-400 font-medium' :
                  'text-muted-foreground'
                }>
                  {p.label}
                </span>
                {p.detail && isPhaseActive(p.id) && (
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {p.detail}
                  </span>
                )}
              </div>
            ))}
          </div>

          {phase === 'complete' && (
            <div
              className={`p-4 border rounded-lg ${
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
                  : `✨ ${messages.newDeck.generateView.successSummary(formData.slideCount)}`}
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
  );
}
