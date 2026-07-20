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
  suggestGlowClassName,
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
      className="relative"
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
        className="min-h-36 resize-y border-0 bg-transparent px-1 py-1 text-base leading-7 shadow-none focus-visible:ring-[3px] focus-visible:ring-[var(--signal)]/35 focus-visible:ring-offset-2 sm:min-h-40 sm:text-[1.05rem]"
      />

      <div className="mt-5 flex flex-col gap-3 border-t border-border/65 pt-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={String(slideCount)}
            onValueChange={(value) => {
              const next = parseComposerSlideCount(value);
              if (next !== null) onSlideCountChange(next);
            }}
            disabled={busy}
          >
            <SelectTrigger aria-label={labels.slideCount} size="sm" className="min-w-24 rounded-xl bg-background/80">
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
            <SelectTrigger aria-label={labels.illustrationStyle} size="sm" className="min-w-40 rounded-xl bg-background/80">
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

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          {showSuggest && onSuggest ? (
            <div className="relative inline-flex">
              {suggestGlowClassName ? (
                <span aria-hidden="true" className={suggestGlowClassName} />
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onSuggest()}
                disabled={busy || !prompt.trim()}
                className="relative rounded-xl"
              >
                {isSuggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {isSuggesting ? labels.suggesting : labels.suggest}
              </Button>
            </div>
          ) : null}
          <Button
            type="submit"
            size="sm"
            disabled={busy || !prompt.trim()}
            className="rounded-xl bg-[var(--signal)] px-5 text-white hover:bg-[var(--signal-strong)]"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {isGenerating ? labels.generating : labels.generate}
          </Button>
        </div>
      </div>

      <p
        id="composer-feedback"
        role={error ? 'alert' : undefined}
        aria-live="polite"
        className={`mt-3 text-sm ${error ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {error || helperText || '\u00a0'}
      </p>
    </form>
  );
}
