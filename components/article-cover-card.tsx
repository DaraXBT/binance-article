'use client';

import { ImageIcon, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';

import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { buildArticleSlideAssetUrl } from '@/lib/article-assets';
import type { ArticleCover } from '@/lib/schemas';

type ArticleCoverCardProps = {
  articleId: string;
  cover: ArticleCover | null | undefined;
  isRetrying: boolean;
  disabled?: boolean;
  onRetry: () => void;
};

export function ArticleCoverCard({
  articleId,
  cover,
  isRetrying,
  disabled = false,
  onRetry,
}: ArticleCoverCardProps) {
  const { messages } = useLanguage();
  const copy = messages.publishing.cover;
  const previewUrl = cover?.imageUrl
    ? buildArticleSlideAssetUrl(articleId, cover.imageUrl)
    : null;
  const status = isRetrying ? 'pending' : (cover?.status ?? 'failed');
  const statusLabel = status === 'generated'
    ? copy.ready
    : status === 'pending'
      ? copy.generating
      : copy.needsAttention;

  return (
    <section
      aria-labelledby="article-cover-heading"
      className="border-b border-dotted border-border/80 bg-background px-4 py-3"
    >
      <div className="mx-auto flex max-w-[96rem] flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative aspect-[5/2] w-full shrink-0 overflow-hidden border border-dotted border-border bg-[#0C0E12] sm:w-64">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={copy.previewAlt}
              className="size-full object-cover object-center"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              {status === 'pending'
                ? <Loader2 aria-hidden="true" className="size-5 animate-spin text-primary" />
                : <ImageIcon aria-hidden="true" className="size-5" />}
            </div>
          )}
          <span className="absolute bottom-2 left-2 border border-white/15 bg-black/70 px-1.5 py-0.5 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-white">
            {copy.safeFrame}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="article-cover-heading" className="font-mono text-xs font-semibold uppercase tracking-[0.12em]">
              {copy.title}
            </h2>
            <span className={`font-mono text-[0.6rem] uppercase tracking-[0.1em] ${
              status === 'generated' ? 'text-primary' : status === 'failed' ? 'text-destructive' : 'text-muted-foreground'
            }`}>
              {statusLabel}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {copy.description}
          </p>
          {cover?.error && status === 'failed' ? (
            <p role="alert" className="mt-1 text-xs text-destructive">{copy.resultFailed}</p>
          ) : null}
          {status === 'generated' ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-primary">
              <ShieldCheck aria-hidden="true" className="size-3.5" />
              {copy.available}
            </p>
          ) : null}
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start rounded-lg sm:self-center"
          disabled={disabled || isRetrying}
          onClick={onRetry}
        >
          {isRetrying
            ? <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            : <RefreshCw aria-hidden="true" className="size-4" />}
          {status === 'generated' ? copy.regenerate : copy.generate}
        </Button>
      </div>
    </section>
  );
}
