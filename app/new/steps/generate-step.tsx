'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useRouter } from 'next/navigation';

interface GenerateStepProps {
  formData: {
    title: string;
    topic: string;
    slideCount: number;
    targetAudience: string;
    style: string;
    additionalNotes: string;
    theme: string;
  };
  onDone: () => void;
}

type GenerateStatus = 'idle' | 'creating' | 'generating' | 'complete' | 'error';

export function GenerateStep({ formData, onDone }: GenerateStepProps) {
  const router = useRouter();
  const [status, setStatus] = useState<GenerateStatus>('idle');
  const [deckId, setDeckId] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [progress, setProgress] = useState(0);

  const handleGenerate = async () => {
    try {
      setStatus('creating');
      setProgress(0);
      setError('');

      // Step 1: Create deck
      console.log('[v0] Creating deck with title:', formData.title);
      const createRes = await fetch('/api/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formData.title,
          description: formData.topic,
        }),
      });

      if (!createRes.ok) {
        throw new Error('Failed to create deck');
      }

      const deckData = await createRes.json();
      const newDeckId = deckData.id;
      setDeckId(newDeckId);
      setProgress(25);

      // Step 2: Generate slides
      setStatus('generating');
      setProgress(50);
      console.log('[v0] Generating slides for deck:', newDeckId);

      const generateRes = await fetch(`/api/decks/${newDeckId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: formData.topic,
          slideCount: formData.slideCount,
          targetAudience: formData.targetAudience,
          style: formData.style,
          additionalNotes: formData.additionalNotes,
          theme: formData.theme,
        }),
      });

      if (!generateRes.ok) {
        const errorData = await generateRes.json();
        throw new Error(errorData.error || 'Failed to generate slides');
      }

      setProgress(75);
      console.log('[v0] Slides generated successfully');

      // Update deck with theme
      setProgress(85);
      await fetch(`/api/decks/${newDeckId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: formData.theme }),
      }).catch(() => {
        // Theme update is optional
      });

      setProgress(100);
      setStatus('complete');
      console.log('[v0] Deck generation complete, redirecting to:', `/decks/${newDeckId}`);

      // Redirect after a short delay
      setTimeout(() => {
        router.push(`/decks/${newDeckId}`);
      }, 1000);
    } catch (err) {
      console.error('[v0] Generation error:', err);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  useEffect(() => {
    if (status === 'idle') {
      handleGenerate();
    }
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-4">Generating Your Deck</h2>
        <p className="text-muted-foreground mb-6">
          {status === 'idle' || status === 'creating'
            ? 'Creating your presentation deck...'
            : status === 'generating'
              ? 'Generating slides with AI...'
              : status === 'complete'
                ? 'Your deck is ready!'
                : 'An error occurred'}
        </p>
      </div>

      {status === 'error' ? (
        <div className="space-y-4">
          <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
            <p className="text-sm text-destructive">{error}</p>
          </div>
          <Button onClick={handleGenerate} variant="outline">
            Try Again
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Progress</p>
              <p className="text-sm text-muted-foreground">{progress}%</p>
            </div>
            <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Status messages */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <div className="h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                {progress >= 25 ? (
                  <span className="text-primary-foreground text-xs">✓</span>
                ) : (
                  <Spinner />
                )}
              </div>
              <span>Creating deck</span>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <div
                className={`h-4 w-4 rounded-full ${
                  progress >= 50 ? 'bg-primary' : 'bg-muted'
                } flex items-center justify-center`}
              >
                {progress >= 75 ? (
                  <span className="text-primary-foreground text-xs">✓</span>
                ) : progress >= 50 ? (
                  <Spinner />
                ) : null}
              </div>
              <span className={progress >= 50 ? 'font-medium' : 'text-muted-foreground'}>
                Generating slides
              </span>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <div
                className={`h-4 w-4 rounded-full ${
                  progress >= 100 ? 'bg-primary' : 'bg-muted'
                } flex items-center justify-center`}
              >
                {progress >= 100 && (
                  <span className="text-primary-foreground text-xs">✓</span>
                )}
              </div>
              <span className={progress >= 100 ? 'font-medium' : 'text-muted-foreground'}>
                Finalizing deck
              </span>
            </div>
          </div>

          {status === 'complete' && (
            <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg">
              <p className="text-sm text-primary">
                Your presentation deck has been created successfully! Redirecting...
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
