'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Circle, Loader2, AlertCircle } from 'lucide-react';

interface GenerateStepProps {
  formData: {
    title: string;
    articleContent: string;
    slideCount: number;
    illustrationStyle: string;
  };
  onDone: () => void;
}

type Phase = 'idle' | 'creating' | 'generating-slides' | 'generating-images' | 'generating-captions' | 'complete' | 'error';

interface PhaseInfo {
  id: Phase;
  label: string;
  detail?: string;
}

export function GenerateStep({ formData, onDone }: GenerateStepProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [deckId, setDeckId] = useState('');
  const [error, setError] = useState('');
  const [imageProgress, setImageProgress] = useState({ current: 0, total: 0 });

  const phases: PhaseInfo[] = [
    { id: 'creating', label: 'Creating deck' },
    { id: 'generating-slides', label: 'Generating slide content' },
    { id: 'generating-images', label: 'Generating images', detail: imageProgress.total > 0 ? `${imageProgress.current}/${imageProgress.total}` : undefined },
    { id: 'generating-captions', label: 'Generating blog & X posts' },
  ];

  const phaseOrder = ['idle', 'creating', 'generating-slides', 'generating-images', 'generating-captions', 'complete'];

  const isPhaseComplete = (phaseId: Phase) => {
    const currentIdx = phaseOrder.indexOf(phase);
    const phaseIdx = phaseOrder.indexOf(phaseId);
    return currentIdx > phaseIdx;
  };

  const isPhaseActive = (phaseId: Phase) => phase === phaseId;

  const handleGenerate = useCallback(async () => {
    try {
      setPhase('creating');
      setError('');

      // Step 1: Create deck
      const createRes = await fetch('/api/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formData.title,
          description: formData.articleContent.slice(0, 200),
          content: formData.articleContent,
          illustrationStyle: formData.illustrationStyle,
        }),
      });

      if (!createRes.ok) throw new Error('Failed to create deck');
      const deckData = await createRes.json();
      const newDeckId = deckData.id;
      setDeckId(newDeckId);

      // Step 2: Generate slides
      setPhase('generating-slides');
      const generateRes = await fetch(`/api/decks/${newDeckId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleContent: formData.articleContent,
          slideCount: formData.slideCount,
          illustrationStyle: formData.illustrationStyle,
        }),
      });

      if (!generateRes.ok) {
        const errorData = await generateRes.json();
        throw new Error(errorData.error || 'Failed to generate slides');
      }

      const genResult = await generateRes.json();

      // Step 3: Generate images
      setPhase('generating-images');
      setImageProgress({ current: 0, total: genResult.slideCount || formData.slideCount });

      const imageRes = await fetch(`/api/decks/${newDeckId}/generate-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          illustrationStyle: formData.illustrationStyle,
        }),
      });

      if (!imageRes.ok) {
        // Image generation is optional - log but don't fail
        console.warn('Image generation had issues, continuing...');
      }

      // Step 4: Captions are already generated with slides
      setPhase('generating-captions');

      // Update deck status
      await fetch(`/api/decks/${newDeckId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: 'default' }),
      }).catch(() => {});

      setPhase('complete');

      // Redirect after a short delay
      setTimeout(() => {
        router.push(`/decks/${newDeckId}`);
      }, 1500);
    } catch (err) {
      console.error('[Generate] Error:', err);
      setPhase('error');
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  }, [formData, router]);

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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-2">
          {phase === 'complete' ? '🎉 Your Deck is Ready!' : 'Generating Your Deck'}
        </h2>
        <p className="text-muted-foreground">
          {phase === 'complete'
            ? 'Slides, images, and captions are all set. Redirecting...'
            : 'Sit tight — we\'re creating your slides, images, and captions'}
        </p>
      </div>

      {phase === 'error' ? (
        <div className="space-y-4">
          <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive mb-1">Generation Failed</p>
              <p className="text-sm text-destructive/80">{error}</p>
            </div>
          </div>
          <Button onClick={handleGenerate} variant="outline" className="gap-2">
            Try Again
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Progress</p>
              <p className="text-sm text-muted-foreground tabular-nums">{progress}%</p>
            </div>
            <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-primary/80 transition-all duration-700 ease-out rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Phase checklist */}
          <div className="space-y-3">
            {phases.map((p) => (
              <div key={p.id} className="flex items-center gap-3 text-sm">
                <div className="flex-shrink-0">
                  {isPhaseComplete(p.id) ? (
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                  ) : isPhaseActive(p.id) ? (
                    <Loader2 className="h-5 w-5 text-primary animate-spin" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground/30" />
                  )}
                </div>
                <span className={
                  isPhaseComplete(p.id) ? 'text-primary font-medium' :
                  isPhaseActive(p.id) ? 'font-medium' :
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
            <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg">
              <p className="text-sm text-primary font-medium">
                ✨ Your deck has been created with {formData.slideCount} slides, custom images, and ready-to-use blog & X post captions!
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
