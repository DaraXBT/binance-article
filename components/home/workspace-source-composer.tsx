'use client';

import { useId, type FormEvent } from 'react';
import { ArrowUp, Layers3, Link2, Loader2, Palette, Sparkles } from 'lucide-react';

import {
  AiPromptBox,
  AiPromptBoxToolbar,
} from '@/components/ui/ai-prompt-box';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  COMPOSER_SLIDE_COUNTS,
  parseComposerIllustrationStyle,
  parseComposerSlideCount,
  type ComposerSlideCount,
} from '@/components/home/prompt-composer';
import { ILLUSTRATION_STYLES, type IllustrationStyleId } from '@/lib/config';
import { normalizeImportUrl, type ArticleSource } from '@/lib/article-source';
import { cn } from '@/lib/utils';

type WorkspaceSourceComposerLabels = {
  sourceLabel: string;
  sourcePrompt: string;
  sourceText: string;
  sourceUrl: string;
  topicLabel: string;
  topicPlaceholder: string;
  textLabel: string;
  textPlaceholder: string;
  urlLabel: string;
  urlPlaceholder: string;
  urlHint: string;
  urlInvalid: string;
  slideCount: string;
  illustrationStyle: string;
  generate: string;
  generateUrl: string;
  generating: string;
  suggest: string;
  suggesting: string;
};

export interface WorkspaceSourceComposerProps {
  source: ArticleSource;
  onSourceChange: (source: ArticleSource) => void;
  value: string;
  onValueChange: (value: string) => void;
  slideCount: ComposerSlideCount;
  onSlideCountChange: (value: ComposerSlideCount) => void;
  illustrationStyle: IllustrationStyleId;
  onIllustrationStyleChange: (value: IllustrationStyleId) => void;
  onGenerate: () => void | Promise<void>;
  onSuggest: () => void | Promise<void>;
  labels: WorkspaceSourceComposerLabels;
  helperText?: string;
  error?: string | null;
  isGenerating?: boolean;
  isSuggesting?: boolean;
  sourceLocked?: boolean;
}

export function WorkspaceSourceComposer({
  source,
  onSourceChange,
  value,
  onValueChange,
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
  sourceLocked = false,
}: WorkspaceSourceComposerProps) {
  const instanceId = useId();
  const inputId = `workspace-source-${instanceId}`;
  const feedbackId = `workspace-source-feedback-${instanceId}`;
  const busy = isGenerating || isSuggesting;
  const isUrl = source === 'url';
  const canSuggest = source === 'prompt';
  const normalizedUrl = isUrl ? normalizeImportUrl(value) : null;
  const canGenerate = Boolean(isUrl ? normalizedUrl : value.trim()) && !busy;
  const feedback = error || (isUrl ? labels.urlHint : helperText);
  const submitLabel = isUrl ? labels.generateUrl : labels.generate;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canGenerate) return;
    void onGenerate();
  };

  return (
    <div data-workspace-source-composer className="space-y-2.5">
      <div
        role="tablist"
        aria-label={labels.sourceLabel}
        className="flex flex-wrap items-center gap-1.5"
      >
        {([
          ['prompt', labels.sourcePrompt],
          ['text', labels.sourceText],
          ['url', labels.sourceUrl],
        ] as const).map(([candidate, label]) => (
          <Button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={source === candidate}
            size="sm"
            variant={source === candidate ? 'default' : 'outline'}
            className="h-8 rounded-lg px-3 text-xs"
            disabled={busy || sourceLocked}
            onClick={() => onSourceChange(candidate)}
          >
            {candidate === 'url' ? <Link2 aria-hidden="true" className="size-3.5" /> : null}
            {label}
          </Button>
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        className="studio-prompt-form relative min-w-0"
        aria-describedby={feedback ? feedbackId : undefined}
        aria-busy={busy || undefined}
        noValidate
      >
        <label htmlFor={inputId} className="sr-only">
          {source === 'prompt' ? labels.topicLabel : source === 'text' ? labels.textLabel : labels.urlLabel}
        </label>
        <AiPromptBox busy={busy} invalid={Boolean(error)}>
          {isUrl ? (
            <div className="relative px-3 pt-3">
              <Link2 aria-hidden="true" className="pointer-events-none absolute left-6 top-1/2 size-4 -translate-y-[15%] text-muted-foreground" />
              <Input
                id={inputId}
                data-workspace-source-input
                type="url"
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
                placeholder={labels.urlPlaceholder}
                autoComplete="url"
                inputMode="url"
                disabled={busy}
                aria-invalid={Boolean(error) || (Boolean(value.trim()) && !normalizedUrl)}
                className="h-11 rounded-lg border-border/70 bg-background/55 pl-9 font-mono text-sm"
              />
            </div>
          ) : (
            <Textarea
              id={inputId}
              data-workspace-source-input
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              placeholder={source === 'prompt' ? labels.topicPlaceholder : labels.textPlaceholder}
              minLength={10}
              maxLength={50_000}
              rows={source === 'text' ? 8 : 3}
              disabled={busy}
              aria-invalid={Boolean(error)}
              className={cn(
                'studio-prompt-input min-h-24 max-h-48 resize-y rounded-none border-0 bg-transparent text-sm leading-relaxed shadow-none focus-visible:ring-0',
                source === 'text' && 'min-h-44 max-h-80',
              )}
            />
          )}

          <AiPromptBoxToolbar
            leading={(
              <div className="grid min-w-0 grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] gap-1.5 sm:flex sm:flex-wrap sm:items-center">
                <Select
                  value={String(slideCount)}
                  onValueChange={(next) => {
                    const parsed = parseComposerSlideCount(next);
                    if (parsed !== null) onSlideCountChange(parsed);
                  }}
                  disabled={busy}
                >
                  <SelectTrigger aria-label={labels.slideCount} size="sm" className="studio-composer-chip w-full min-w-0 rounded-full border-border/70 bg-background/65 px-2.5 text-xs shadow-none sm:w-auto sm:min-w-24">
                    <Layers3 aria-hidden="true" className="size-3.5" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start" sideOffset={6} collisionPadding={12} className="rounded-xl border-border/80 shadow-lg">
                    {COMPOSER_SLIDE_COUNTS.map((count) => <SelectItem key={count} value={String(count)} className="rounded-lg">{count}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select
                  value={illustrationStyle}
                  onValueChange={(next) => {
                    const parsed = parseComposerIllustrationStyle(next);
                    if (parsed !== null) onIllustrationStyleChange(parsed);
                  }}
                  disabled={busy}
                >
                  <SelectTrigger aria-label={labels.illustrationStyle} size="sm" className="studio-composer-chip w-full min-w-0 rounded-full border-border/70 bg-background/65 px-2.5 text-xs shadow-none sm:w-auto sm:min-w-40">
                    <Palette aria-hidden="true" className="size-3.5" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start" sideOffset={6} collisionPadding={12} className="rounded-xl border-border/80 shadow-lg">
                    {ILLUSTRATION_STYLES.map((style) => <SelectItem key={style.id} value={style.id} className="rounded-lg">{style.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            trailing={(
              <div className={cn('min-w-0 items-center justify-end gap-1.5', canSuggest ? 'grid grid-cols-[minmax(0,1fr)_auto] sm:flex' : 'flex')}>
                {canSuggest ? (
                  <Button type="button" variant="outline" size="sm" shape="pill" onClick={() => void onSuggest()} disabled={busy || !value.trim()} aria-label={isSuggesting ? labels.suggesting : labels.suggest} className="studio-composer-chip min-w-0 shrink px-3 text-xs sm:w-auto">
                    {isSuggesting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    <span className="truncate">{isSuggesting ? labels.suggesting : labels.suggest}</span>
                  </Button>
                ) : null}
                <Button type="submit" size="sm" shape="pill" disabled={!canGenerate} className="studio-submit-button h-9 px-3.5" aria-label={isGenerating ? labels.generating : submitLabel}>
                  {isGenerating ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                  <span>{isGenerating ? labels.generating : submitLabel}</span>
                </Button>
              </div>
            )}
          />
        </AiPromptBox>
        {feedback ? <p id={feedbackId} role={error ? 'alert' : undefined} aria-live="polite" className={cn('mt-2 min-h-5 text-xs leading-relaxed', error ? 'text-destructive-text' : 'text-muted-foreground')}>{error || feedback}</p> : null}
      </form>
    </div>
  );
}
