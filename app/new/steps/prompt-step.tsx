'use client';

import { useRef, useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, Lock, Sparkles } from 'lucide-react';
import { getAiSuggestGlowClassName, requestPromptSuggestion } from '@/components/home/dashboard-home';
import { GenerateAccessDialog } from '@/components/generate-access-dialog';
import { GenerateAccessError } from '@/lib/generate-access-error';

interface PromptStepProps {
  formData: {
    title: string;
    articleContent: string;
  };
  onUpdate: (updates: any) => void;
  fetchImpl?: typeof fetch;
  generationLocked?: boolean;
  onUnlock?: () => void;
}

function extractTitleFromContent(content: string): string {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim().slice(0, 80);
  const firstLine = content.split('\n').find((line) => line.trim().length > 0);
  return firstLine ? firstLine.trim().slice(0, 80) : '';
}

export function PromptStep({
  formData,
  onUpdate,
  fetchImpl,
  generationLocked = false,
  onUnlock,
}: PromptStepProps) {
  const { messages } = useLanguage();
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [showAccessDialog, setShowAccessDialog] = useState(false);
  const pendingRetryRef = useRef<(() => void) | null>(null);

  const doAutoGenerate = async () => {
    setIsGenerating(true);
    setGenError('');

    try {
      const suggestedPrompt = await requestPromptSuggestion({
        title: extractTitleFromContent(formData.articleContent) || formData.articleContent.slice(0, 100),
        fetchImpl,
      });
      onUpdate({ articleContent: suggestedPrompt });
    } catch (err) {
      if (err instanceof GenerateAccessError) {
        pendingRetryRef.current = () => void doAutoGenerate();
        setShowAccessDialog(true);
        setIsGenerating(false);
        return;
      }
      setGenError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAutoGenerate = async () => {
    if (!formData.articleContent.trim()) return;

    if (generationLocked) {
      pendingRetryRef.current = () => void doAutoGenerate();
      setShowAccessDialog(true);
      return;
    }

    await doAutoGenerate();
  };

  const handleAccessSuccess = () => {
    onUnlock?.();
    setShowAccessDialog(false);
    const retry = pendingRetryRef.current;
    pendingRetryRef.current = null;
    if (retry) retry();
  };

  const canGenerate =
    formData.articleContent.trim().length >= 1 && !isGenerating && !generationLocked;

  return (
    <>
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-2xl font-semibold">{messages.newDeck.promptView.title}</h2>
        <p className="mb-6 text-muted-foreground">
          {messages.newDeck.promptView.subtitle}
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <Label htmlFor="articleContent" className="mb-2 block text-sm font-medium">
            {messages.newDeck.promptView.promptLabel}
          </Label>
          {generationLocked ? (
            <div className="mb-3 flex flex-col gap-3 border border-dotted border-[var(--access-signal)]/45 bg-[var(--access-signal)]/5 px-3 py-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{messages.newDeck.promptView.generationLockedBanner}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-2 self-start rounded-none border-dotted sm:self-auto"
                onClick={() => setShowAccessDialog(true)}
              >
                <Lock className="h-4 w-4" />
                {messages.generateAccess.submit}
              </Button>
            </div>
          ) : null}
          <div className="relative">
            <Textarea
              id="articleContent"
              placeholder={messages.newDeck.promptView.promptPlaceholder}
              value={formData.articleContent}
              onChange={(e) => onUpdate({ articleContent: e.target.value })}
              rows={8}
              className={`min-h-[150px] resize-y rounded-none border-dotted text-sm leading-relaxed sm:pr-28 ${
                isGenerating ? 'opacity-50' : ''
              }`}
              disabled={isGenerating}
            />
            <div className="mt-2 flex justify-end sm:absolute sm:bottom-3 sm:right-3 sm:mt-0">
              <div className="relative inline-flex">
                <span
                  aria-hidden="true"
                  className={getAiSuggestGlowClassName({
                    hasTopic: Boolean(formData.articleContent.trim()),
                    isSuggesting: isGenerating,
                  })}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAutoGenerate}
                  disabled={!canGenerate}
                  className="gap-2 rounded-none border-dotted"
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {isGenerating ? messages.dashboard.aiSuggestLoading : messages.dashboard.aiSuggest}
                </Button>
              </div>
            </div>
          </div>
          {genError ? (
            <p className="mt-1.5 text-xs text-destructive">{genError}</p>
          ) : (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {generationLocked
                ? messages.newDeck.promptView.generationLockedHint
                : formData.articleContent.trim()
                ? messages.newDeck.promptView.promptHintWithTopic
                : messages.newDeck.promptView.promptHintEmpty}
            </p>
          )}
        </div>
      </div>
    </div>
    <GenerateAccessDialog
      open={showAccessDialog}
      onOpenChange={setShowAccessDialog}
      onSuccess={handleAccessSuccess}
    />
    </>
  );
}
