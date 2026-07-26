'use client';

import { useCallback } from 'react';
import { useLanguage } from '@/components/language-provider';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { FileText, Type } from 'lucide-react';

import type { WizardFormUpdate } from './types';

interface ContentStepProps {
  formData: {
    title: string;
    articleContent: string;
  };
  onUpdate: (updates: WizardFormUpdate) => void;
}

function extractTitle(content: string): string {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Match markdown heading
    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) return headingMatch[1].trim();
    // Use first non-empty line as title
    return trimmed.length > 80 ? trimmed.slice(0, 80) : trimmed;
  }
  return '';
}

export function ContentStep({ formData, onUpdate }: ContentStepProps) {
  const { messages } = useLanguage();
  const wordCount = formData.articleContent.trim().split(/\s+/).filter(Boolean).length;

  const handleContentChange = useCallback(
    (content: string) => {
      const extracted = extractTitle(content);
      onUpdate({ articleContent: content, ...(extracted ? { title: extracted } : {}) });
    },
    [onUpdate]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-2">{messages.newDeck.content.title}</h2>
        <p className="text-muted-foreground mb-6">
          {messages.newDeck.content.subtitle}
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <Label htmlFor="articleContent" className="mb-2 block text-sm font-medium">
            {messages.newDeck.content.articleContent}
          </Label>
          <div className="relative">
            <Textarea
              id="articleContent"
              placeholder={messages.newDeck.content.contentPlaceholder}
              value={formData.articleContent}
              onChange={(e) => handleContentChange(e.target.value)}
              rows={16}
              className="min-h-[250px] resize-y rounded-xl border-border/70 bg-background/50 text-sm leading-relaxed"
            />
            <div className="absolute bottom-3 right-3 flex items-center gap-1.5 border border-dotted border-border bg-background/90 px-2 py-1 font-mono text-xs text-muted-foreground">
              <FileText className="h-3 w-3" />
              {messages.newDeck.content.wordCount(wordCount)}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {messages.newDeck.content.markdownHint}
          </p>
        </div>

        {formData.title ? (
          <div className="flex items-center gap-2 rounded-lg border border-dotted border-border/60 bg-muted/30 px-3 py-2">
            <Type className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground">{messages.newDeck.content.articleTitle}:</span>
            <span className="text-sm font-medium truncate">{formData.title}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
