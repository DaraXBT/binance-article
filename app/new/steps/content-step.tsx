'use client';

import { useLanguage } from '@/components/language-provider';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { FileText } from 'lucide-react';

interface ContentStepProps {
  formData: {
    title: string;
    articleContent: string;
  };
  onUpdate: (updates: any) => void;
}

export function ContentStep({ formData, onUpdate }: ContentStepProps) {
  const { messages } = useLanguage();
  const wordCount = formData.articleContent.trim().split(/\s+/).filter(Boolean).length;

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
          <Label htmlFor="title" className="mb-2 block text-sm font-medium">
            {messages.newDeck.content.articleTitle}
          </Label>
          <Input
            id="title"
            placeholder={messages.newDeck.content.titlePlaceholder}
            value={formData.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            className="text-base"
          />
        </div>

        <div>
          <Label htmlFor="articleContent" className="mb-2 block text-sm font-medium">
            {messages.newDeck.content.articleContent}
          </Label>
          <div className="relative">
            <Textarea
              id="articleContent"
              placeholder={messages.newDeck.content.contentPlaceholder}
              value={formData.articleContent}
              onChange={(e) => onUpdate({ articleContent: e.target.value })}
              rows={14}
              className="text-sm leading-relaxed resize-y min-h-[200px]"
            />
            <div className="absolute bottom-3 right-3 flex items-center gap-1.5 text-xs text-muted-foreground bg-background/80 backdrop-blur-sm px-2 py-1 rounded">
              <FileText className="h-3 w-3" />
              {messages.newDeck.content.wordCount(wordCount)}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {messages.newDeck.content.markdownHint}
          </p>
        </div>
      </div>
    </div>
  );
}
