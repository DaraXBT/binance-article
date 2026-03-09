'use client';

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
  const wordCount = formData.articleContent.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Paste Your Article</h2>
        <p className="text-muted-foreground mb-6">
          Drop in your full article — we&apos;ll turn it into slides with images
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <Label htmlFor="title" className="mb-2 block text-sm font-medium">
            Article Title
          </Label>
          <Input
            id="title"
            placeholder="e.g., 24/7 Crypto Infrastructure for Gold Traders"
            value={formData.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            className="text-base"
          />
        </div>

        <div>
          <Label htmlFor="articleContent" className="mb-2 block text-sm font-medium">
            Article Content
          </Label>
          <div className="relative">
            <Textarea
              id="articleContent"
              placeholder="Paste your full article here (markdown or plain text)..."
              value={formData.articleContent}
              onChange={(e) => onUpdate({ articleContent: e.target.value })}
              rows={14}
              className="text-sm leading-relaxed resize-y min-h-[200px]"
            />
            <div className="absolute bottom-3 right-3 flex items-center gap-1.5 text-xs text-muted-foreground bg-background/80 backdrop-blur-sm px-2 py-1 rounded">
              <FileText className="h-3 w-3" />
              {wordCount} words
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Supports markdown formatting. Longer articles produce richer slides.
          </p>
        </div>
      </div>
    </div>
  );
}
