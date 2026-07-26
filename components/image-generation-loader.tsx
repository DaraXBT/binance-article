'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { SparklesIcon } from 'lucide-react';
import { useTheme } from 'next-themes';

import { DotGridSpotlight } from '@/components/ui/dot-grid-spotlight';
import { cn } from '@/lib/utils';

export interface ImageGenerationLoaderProps {
  label: string;
  detail?: string;
  backdrop?: ReactNode;
  size?: 'default' | 'compact';
  className?: string;
}

const GRID_COLORS = {
  light: {
    dot: 'rgba(49, 94, 246, 0.12)',
    active: 'rgba(49, 94, 246, 0.72)',
  },
  dark: {
    dot: 'rgba(200, 252, 52, 0.10)',
    active: 'rgba(200, 252, 52, 0.72)',
  },
} as const;

export function ImageGenerationLoader({
  label,
  detail,
  backdrop,
  size = 'default',
  className,
}: ImageGenerationLoaderProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const palette = resolvedTheme === 'light' || resolvedTheme === 'dark'
    ? GRID_COLORS[resolvedTheme]
    : null;

  useEffect(() => {
    setMounted(true);
  }, []);

  const compact = size === 'compact';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy="true"
      data-slot="image-generation-loader"
      data-size={size}
      data-has-backdrop={backdrop ? 'true' : 'false'}
      className={cn(
        'relative isolate flex w-full items-center justify-center overflow-hidden rounded-xl border bg-muted/35 text-center',
        compact ? 'min-h-28 p-4' : 'min-h-48 p-6',
        className,
      )}
    >
      {backdrop ? (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-20 overflow-hidden opacity-30 saturate-50 [&>*]:size-full [&>img]:object-cover"
          >
            {backdrop}
          </div>
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-background/75"
          />
        </>
      ) : null}

      {mounted && palette ? (
        <DotGridSpotlight
          dotColor={palette.dot}
          activeDotColor={palette.active}
          spacing={compact ? 12 : 14}
          baseRadius={1}
          activeRadius={compact ? 1.8 : 2.25}
          interactionRadius={compact ? 96 : 160}
          activeMinAlpha={0.35}
          activeMaxAlpha={1}
          motion="auto-pointer"
          className="z-0"
        />
      ) : null}

      <div
        className={cn(
          'relative z-10 flex max-w-sm flex-col items-center',
          compact ? 'gap-2' : 'gap-3',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex items-center justify-center rounded-full border border-primary/25 bg-background/80 text-primary shadow-[0_0_32px_color-mix(in_oklab,var(--primary)_24%,transparent)] backdrop-blur-sm',
            compact ? 'size-8' : 'size-10',
          )}
        >
          <SparklesIcon className={compact ? 'size-4' : 'size-5'} />
        </span>

        <div className="space-y-1">
          <p className={cn('font-medium text-foreground', compact ? 'text-sm' : 'text-base')}>
            {label}
          </p>
          {detail ? (
            <p className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
              {detail}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
