'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, Sparkles } from 'lucide-react';

interface PromptStepProps {
  formData: {
    title: string;
    articleContent: string;
  };
  onUpdate: (updates: any) => void;
}

export function PromptStep({ formData, onUpdate }: PromptStepProps) {
  const { messages } = useLanguage();
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  const handleAutoGenerate = async () => {
    if (!formData.title.trim()) return;

    setIsGenerating(true);
    setGenError('');

    try {
      const res = await fetch('/api/articles/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: formData.title.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate prompt');
      }

      onUpdate({ articleContent: data.prompt });
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
            <button
              type="button"
              onClick={handleAutoGenerate}
              disabled={!canGenerate}
              className={`absolute bottom-3 right-3 flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition-all ${
                canGenerate
                  ? 'bg-[#F0B90B]/15 text-[#F0B90B] border border-[#F0B90B]/30 hover:bg-[#F0B90B]/25 hover:border-[#F0B90B]/50 hover:shadow-[0_0_12px_rgba(240,185,11,0.15)] cursor-pointer'
                  : isGenerating
                    ? 'bg-[#F0B90B]/10 text-[#F0B90B]/70 border border-[#F0B90B]/20 cursor-wait'
                    : 'bg-background/80 text-muted-foreground cursor-not-allowed'
              }`}
            >
              {isGenerating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {isGenerating ? 'Generating...' : '✨ AI Prompt'}
            </button>
          </div>
          {genError ? (
            <p className="mt-1.5 text-xs text-destructive">{genError}</p>
          ) : (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {formData.title.trim()
                ? 'Click "✨ AI Prompt" to auto-generate instructions from your topic title, or write your own.'
                : 'Enter a topic title first, then click "✨ AI Prompt" to auto-generate.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
