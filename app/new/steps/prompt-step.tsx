'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles } from 'lucide-react';
import { getAiSuggestGlowClassName, requestPromptSuggestion } from '@/components/home/dashboard-home';

interface PromptStepProps {
  formData: {
    title: string;
    articleContent: string;
  };
  onUpdate: (updates: any) => void;
  fetchImpl?: typeof fetch;
}

function extractTitleFromContent(content: string): string {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim().slice(0, 80);
  const firstLine = content.split('\n').find((line) => line.trim().length > 0);
  return firstLine ? firstLine.trim().slice(0, 80) : '';
}

export function PromptStep({ formData, onUpdate, fetchImpl }: PromptStepProps) {
  const { messages } = useLanguage();
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  const handleAutoGenerate = async () => {
    if (!formData.articleContent.trim()) return;

    setIsGenerating(true);
    setGenError('');

    try {
      const suggestedPrompt = await requestPromptSuggestion({
        title: extractTitleFromContent(formData.articleContent) || formData.articleContent.slice(0, 100),
        fetchImpl,
      });
      onUpdate({ articleContent: suggestedPrompt });
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const canGenerate = formData.articleContent.trim().length >= 1 && !isGenerating;

  return (
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
          <div className="relative">
            <Textarea
              id="articleContent"
              placeholder={messages.newDeck.promptView.promptPlaceholder}
              value={formData.articleContent}
              onChange={(e) => onUpdate({ articleContent: e.target.value })}
              rows={8}
              className={`min-h-[150px] resize-y text-sm leading-relaxed sm:pr-28 ${
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
                  className="gap-2"
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
              {formData.articleContent.trim()
                ? messages.newDeck.promptView.promptHintWithTopic
                : messages.newDeck.promptView.promptHintEmpty}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
