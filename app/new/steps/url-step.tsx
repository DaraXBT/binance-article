'use client';

import { useLanguage } from '@/components/language-provider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Layers3 } from 'lucide-react';

interface UrlStepProps {
  formData: {
    title: string;
    articleContent: string;
  };
  onUpdate: (updates: any) => void;
}

export function UrlStep({ formData, onUpdate }: UrlStepProps) {
  const { messages } = useLanguage();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-2xl font-semibold">Import from URL</h2>
        <p className="mb-6 text-muted-foreground">
          Paste a link to any blog post, news article, or webpage. We&apos;ll extract the content and turn it into slides.
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <Label htmlFor="url" className="mb-2 block text-sm font-medium">
            Webpage URL
          </Label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
              <Layers3 className="h-4 w-4" />
            </div>
            <Input
              id="url"
              type="url"
              placeholder="https://example.com/great-article"
              value={formData.title} // Repurposing title to temporarily hold the URL for step 1 validation
              onChange={(e) => onUpdate({ title: e.target.value, articleContent: 'Content will be extracted from the URL...' })}
              className="h-11 rounded-lg border-dotted pl-9 font-mono text-base"
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            We will automatically scrape the text content from this link when you generate.
          </p>
        </div>
      </div>
    </div>
  );
}
