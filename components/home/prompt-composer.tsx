'use client';

import type { FormEvent } from 'react';
import { Loader2, Send, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ILLUSTRATION_STYLES, type IllustrationStyleId } from '@/lib/config';

export const COMPOSER_SLIDE_COUNTS = [1, 3, 5, 7, 10, 15] as const;
export type ComposerSlideCount = (typeof COMPOSER_SLIDE_COUNTS)[number];
export const MINIMUM_PROMPT_LENGTH = 10;

export function parseComposerSlideCount(value: string): ComposerSlideCount | null {
  const count = Number(value);
  return COMPOSER_SLIDE_COUNTS.includes(count as ComposerSlideCount)
    ? count as ComposerSlideCount
    : null;
}

export function parseComposerIllustrationStyle(value: string): IllustrationStyleId | null {
  return ILLUSTRATION_STYLES.some((style) => style.id === value)
    ? value as IllustrationStyleId
    : null;
}

export function PromptComposer({
  prompt,
  onPromptChange,
  slideCount,
  onSlideCountChange,
  illustrationStyle,
  onIllustrationStyleChange,
  onGenerate,
  onSuggest,
  labels,
  helperText,
  error,
  isGenerating = false,
  isSuggesting = false,
  showSuggest = false,
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
  slideCount: ComposerSlideCount;
  onSlideCountChange: (value: ComposerSlideCount) => void;
  illustrationStyle: IllustrationStyleId;
  onIllustrationStyleChange: (value: IllustrationStyleId) => void;
  onGenerate: () => void | Promise<void>;
  onSuggest?: () => void | Promise<void>;
  labels: {
    prompt: string;
    placeholder: string;
    slideCount: string;
    illustrationStyle: string;
    generate: string;
    generating: string;
    suggest?: string;
    suggesting?: string;
    styleNames: Record<IllustrationStyleId, string>;
  };
  helperText?: string;
  error?: string | null;
  isGenerating?: boolean;
  isSuggesting?: boolean;
  showSuggest?: boolean;
  suggestGlowClassName?: string;
}) {
  const busy = isGenerating || isSuggesting;
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onGenerate();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="relative min-w-0"
      aria-describedby="composer-feedback"
      noValidate
    >
      <label htmlFor="article-prompt" className="sr-only">{labels.prompt}</label>
      <Textarea
        id="article-prompt"
        name="prompt"
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder={labels.placeholder}
        minLength={MINIMUM_PROMPT_LENGTH}
        maxLength={50_000}
        rows={5}
        disabled={busy}
        aria-invalid={Boolean(error)}
        aria-describedby="composer-feedback"
        className="min-h-32 resize-y rounded-none border border-dotted border-border/80 bg-background/35 px-3 py-3 text-base leading-7 shadow-none placeholder:text-muted-foreground/65 focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:ring-offset-0 max-[390px]:min-h-20 max-[390px]:py-2 sm:min-h-36 sm:text-[1.02rem]"
      />

      <div className="mt-3 flex flex-col gap-3 border-t border-border/70 pt-3 max-[390px]:flex-row max-[390px]:items-center max-[390px]:justify-between max-[390px]:gap-1 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2 max-[390px]:min-w-0 max-[390px]:flex-1 max-[390px]:flex-nowrap max-[390px]:gap-1">
          <Select
            value={String(slideCount)}
            onValueChange={(value) => {
              const next = parseComposerSlideCount(value);
              if (next !== null) onSlideCountChange(next);
            }}
            disabled={busy}
          >
            <SelectTrigger aria-label={labels.slideCount} size="sm" className="min-w-24 rounded-none border-dotted bg-background/55 max-[390px]:min-w-0 max-[390px]:flex-1 max-[390px]:px-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPOSER_SLIDE_COUNTS.map((count) => (
                <SelectItem key={count} value={String(count)}>{count}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={illustrationStyle}
            onValueChange={(value) => {
              const next = parseComposerIllustrationStyle(value);
              if (next !== null) onIllustrationStyleChange(next);
            }}
            disabled={busy}
          >
            <SelectTrigger aria-label={labels.illustrationStyle} size="sm" className="min-w-40 rounded-none border-dotted bg-background/55 max-[390px]:min-w-0 max-[390px]:flex-[1.5] max-[390px]:px-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ILLUSTRATION_STYLES.map((style) => (
                <SelectItem key={style.id} value={style.id}>
                  {labels.styleNames[style.id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2 max-[390px]:shrink-0 max-[390px]:flex-row max-[390px]:gap-1 sm:flex-row sm:justify-end">
          {showSuggest && onSuggest ? (
            <div className="inline-flex">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onSuggest()}
                disabled={busy || !prompt.trim()}
                aria-label={isSuggesting ? labels.suggesting : labels.suggest}
                className="rounded-none border-dotted max-[390px]:size-8 max-[390px]:p-0"
              >
                {isSuggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                <span className="max-[390px]:hidden">{isSuggesting ? labels.suggesting : labels.suggest}</span>
              </Button>
            </div>
          ) : null}
          <Button
            type="submit"
            size="sm"
            disabled={busy || !prompt.trim()}
            className="w-full rounded-none bg-primary px-5 text-primary-foreground hover:bg-primary/90 max-[390px]:size-8 max-[390px]:w-8 max-[390px]:shrink-0 max-[390px]:p-0 sm:w-auto"
            aria-label={isGenerating ? labels.generating : labels.generate}
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="max-[390px]:hidden">{isGenerating ? labels.generating : labels.generate}</span>
          </Button>
        </div>
      </div>

      <p
        id="composer-feedback"
        role={error ? 'alert' : undefined}
        aria-live="polite"
        className={`mt-3 min-h-5 text-sm ${error ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {error || helperText || '\u00a0'}
      </p>
    </form>
  );
}
