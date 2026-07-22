'use client';

import { useId, type FormEvent, type KeyboardEvent, type Ref } from 'react';
import { ArrowUp, Layers3, Loader2, Palette, Sparkles } from 'lucide-react';

import {
  AiPromptBox,
  AiPromptBoxTextarea,
  AiPromptBoxToolbar,
} from '@/components/ui/ai-prompt-box';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ILLUSTRATION_STYLES, type IllustrationStyleId } from '@/lib/config';
import { cn } from '@/lib/utils';

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

type PromptComposerLabels = {
  prompt: string;
  placeholder: string;
  slideCount: string;
  illustrationStyle: string;
  generate: string;
  generating: string;
};

type PromptComposerBaseProps = {
  textareaRef?: Ref<HTMLTextAreaElement>;
  prompt: string;
  onPromptChange: (value: string) => void;
  slideCount: ComposerSlideCount;
  onSlideCountChange: (value: ComposerSlideCount) => void;
  illustrationStyle: IllustrationStyleId;
  onIllustrationStyleChange: (value: IllustrationStyleId) => void;
  onGenerate: () => void | Promise<void>;
  helperText?: string;
  error?: string | null;
  isGenerating?: boolean;
  isSuggesting?: boolean;
  suggestGlowClassName?: string;
};

export type PromptComposerProps = PromptComposerBaseProps & (
  | {
      showSuggest: true;
      onSuggest: () => void | Promise<void>;
      labels: PromptComposerLabels & {
        suggest: string;
        suggesting: string;
      };
    }
  | {
      showSuggest?: false;
      onSuggest?: () => void | Promise<void>;
      labels: PromptComposerLabels & {
        suggest?: string;
        suggesting?: string;
      };
    }
);

export function PromptComposer({
  textareaRef,
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
}: PromptComposerProps) {
  const instanceId = useId();
  const promptId = `article-prompt-${instanceId}`;
  const feedbackId = `composer-feedback-${instanceId}`;
  const busy = isGenerating || isSuggesting;
  const feedback = error || helperText;
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !prompt.trim()) return;
    void onGenerate();
  };
  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== 'Enter'
      || (!event.metaKey && !event.ctrlKey)
      || event.nativeEvent.isComposing
      || busy
      || !prompt.trim()
    ) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };
  const currentGenerateLabel = isGenerating ? labels.generating : labels.generate;
  const currentSuggestLabel = showSuggest
    ? (isSuggesting ? labels.suggesting : labels.suggest)
    : undefined;

  return (
    <form
      onSubmit={handleSubmit}
      data-article-studio-composer-form
      className="studio-prompt-form relative min-w-0"
      aria-describedby={feedback ? feedbackId : undefined}
      aria-busy={busy || undefined}
      noValidate
    >
      <label htmlFor={promptId} className="sr-only">{labels.prompt}</label>
      <AiPromptBox busy={busy} invalid={Boolean(error)}>
        <AiPromptBoxTextarea
          ref={textareaRef}
          id={promptId}
          name="prompt"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={handlePromptKeyDown}
          placeholder={labels.placeholder}
          minLength={MINIMUM_PROMPT_LENGTH}
          maxLength={50_000}
          rows={3}
          disabled={busy}
          aria-invalid={Boolean(error)}
          aria-describedby={feedback ? feedbackId : undefined}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          className="studio-prompt-input"
        />

        <AiPromptBoxToolbar
          leading={(
            <div className="grid min-w-0 grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] gap-1.5 sm:flex sm:flex-wrap sm:items-center">
              <Select
                value={String(slideCount)}
                onValueChange={(value) => {
                  const next = parseComposerSlideCount(value);
                  if (next !== null) onSlideCountChange(next);
                }}
                disabled={busy}
              >
                <SelectTrigger
                  aria-label={labels.slideCount}
                  size="sm"
                  className="studio-composer-chip w-full min-w-0 rounded-full border-border/70 bg-background/65 px-2.5 text-xs shadow-none sm:w-auto sm:min-w-24"
                >
                  <Layers3 aria-hidden="true" className="size-3.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  align="start"
                  sideOffset={6}
                  collisionPadding={12}
                  className="rounded-2xl border-border/80 shadow-lg"
                >
                  {COMPOSER_SLIDE_COUNTS.map((count) => (
                    <SelectItem key={count} value={String(count)} className="rounded-xl">
                      {count}
                    </SelectItem>
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
                <SelectTrigger
                  aria-label={labels.illustrationStyle}
                  size="sm"
                  className="studio-composer-chip w-full min-w-0 rounded-full border-border/70 bg-background/65 px-2.5 text-xs shadow-none sm:w-auto sm:min-w-40"
                >
                  <Palette aria-hidden="true" className="size-3.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  align="start"
                  sideOffset={6}
                  collisionPadding={12}
                  className="rounded-2xl border-border/80 shadow-lg"
                >
                  {ILLUSTRATION_STYLES.map((style) => (
                    <SelectItem key={style.id} value={style.id} className="rounded-xl">
                      {style.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          trailing={(
            <div
              className={cn(
                'min-w-0 items-center justify-end gap-1.5',
                showSuggest && onSuggest
                  ? 'grid grid-cols-[minmax(0,1fr)_auto] sm:flex'
                  : 'flex',
              )}
            >
              {showSuggest && onSuggest ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  shape="pill"
                  onClick={() => void onSuggest()}
                  disabled={busy || !prompt.trim()}
                  aria-label={currentSuggestLabel}
                  className="studio-composer-chip min-w-0 shrink px-3 text-xs sm:w-auto"
                >
                  {isSuggesting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  <span className="truncate">{currentSuggestLabel}</span>
                </Button>
              ) : null}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="submit"
                    size="sm"
                    shape="pill"
                    disabled={busy || !prompt.trim()}
                    className="studio-submit-button h-9 px-3.5 max-[389px]:size-9 max-[389px]:p-0"
                    aria-label={currentGenerateLabel}
                  >
                    {isGenerating ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ArrowUp className="size-4" />
                    )}
                    <span className="hidden min-[390px]:inline">{currentGenerateLabel}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align="end"
                  sideOffset={10}
                  className="rounded-lg shadow-md"
                >
                  {currentGenerateLabel}
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        />
      </AiPromptBox>

      {feedback ? (
        <p
          id={feedbackId}
          role={error ? 'alert' : undefined}
          aria-live="polite"
          className={`mt-2 min-h-5 text-xs leading-relaxed ${error ? 'text-destructive-text' : 'text-muted-foreground'}`}
        >
          {feedback}
        </p>
      ) : null}
    </form>
  );
}
