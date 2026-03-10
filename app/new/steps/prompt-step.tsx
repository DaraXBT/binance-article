'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { Input } from '@/components/ui/input';
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

export function PromptStep({ formData, onUpdate, fetchImpl }: PromptStepProps) {
  useLanguage();
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  const handleAutoGenerate = async () => {
    if (!formData.title.trim()) return;

    setIsGenerating(true);
    setGenError('');

    try {
      const suggestedPrompt = await requestPromptSuggestion({
        title: formData.title,
        fetchImpl,
      });
      onUpdate({ articleContent: suggestedPrompt });
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const canGenerate = formData.title.trim().length >= 1 && !isGenerating;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-2xl font-semibold">Generate with AI</h2>
        <p className="mb-6 text-muted-foreground">
          Describe the topic or idea you want to present. Our AI will write the full article and generate the slides for you.
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <Label htmlFor="title" className="mb-2 block text-sm font-medium">
            Topic Title
          </Label>
          <Input
            id="title"
            placeholder="e.g., The Future of Web3 Wallets"
            value={formData.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            className="text-base"
          />
        </div>

        <div>
          <Label htmlFor="articleContent" className="mb-2 block text-sm font-medium">
            Detailed Instructions (Prompt)
          </Label>
          <div className="relative">
            <Textarea
              id="articleContent"
              placeholder="Write a comprehensive article exploring the evolution of crypto wallets over the next 5 years, focusing on account abstraction and seamless onboarding..."
              value={formData.articleContent}
              onChange={(e) => onUpdate({ articleContent: e.target.value })}
              rows={8}
              className={`min-h-[150px] resize-y text-sm leading-relaxed pr-28 ${
                isGenerating ? 'opacity-50' : ''
              }`}
              disabled={isGenerating}
            />
            <div className="absolute bottom-3 right-3">
              <div className="relative inline-flex">
                <span
                  aria-hidden="true"
                  className={getAiSuggestGlowClassName({
                    hasTopic: Boolean(formData.title.trim()),
                    isSuggesting: isGenerating,
                  })}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAutoGenerate}
                  disabled={!canGenerate}
                  className="gap-2"
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {isGenerating ? 'Suggesting...' : 'AI Suggest'}
                </Button>
              </div>
            </div>
          </div>
          {genError ? (
            <p className="mt-1.5 text-xs text-destructive">{genError}</p>
          ) : (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {formData.title.trim()
                ? 'Click AI Suggest to auto-generate instructions from your topic title, or write your own.'
                : 'Enter a topic title first, then click AI Suggest to auto-generate.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
