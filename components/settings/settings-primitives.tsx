import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** The visible title block at the top of every Account settings section. */
export function SettingsSectionHeader({
  id,
  title,
  description,
  className,
}: {
  id: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 md:pr-12', className)}>
      <h2 id={id} className="text-lg font-semibold leading-7 text-foreground">
        {title}
      </h2>
      {description ? (
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
    </header>
  );
}

/**
 * A titled group inside a section. Consecutive groups are separated by a
 * hairline instead of nested card borders.
 */
export function SettingsGroup({
  title,
  titleId,
  description,
  actions,
  children,
  className,
  ...props
}: {
  title?: ReactNode;
  titleId?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
} & Omit<React.ComponentProps<'section'>, 'title'>) {
  const hasHeader = Boolean(title || description || actions);
  return (
    <section
      aria-labelledby={title && titleId ? titleId : undefined}
      className={cn(
        'border-t border-border/70 pt-6 first:border-t-0 first:pt-0',
        className,
      )}
      {...props}
    >
      {hasHeader ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-[min(100%,15rem)] flex-1">
            {title ? (
              <h3
                id={titleId}
                tabIndex={titleId ? -1 : undefined}
                className="text-sm font-semibold leading-6 text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {title}
              </h3>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export type StatusTone = 'success' | 'info' | 'warning' | 'neutral';

const NEUTRAL_BADGE = 'border-border bg-muted/40 text-foreground';

const STATUS_TONE_CLASSES: Record<StatusTone, { badge: string; dot: string }> = {
  // One neutral pill for every status; only the dot carries meaning.
  success: { badge: NEUTRAL_BADGE, dot: 'bg-emerald-500' },
  info: { badge: NEUTRAL_BADGE, dot: 'bg-sky-500' },
  warning: { badge: NEUTRAL_BADGE, dot: 'bg-amber-500' },
  neutral: { badge: 'border-border bg-transparent text-muted-foreground', dot: 'bg-muted-foreground/50' },
};

/** One status style for every section: a dot plus a short label. */
export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  const classes = STATUS_TONE_CLASSES[tone];
  return (
    <span
      data-status-tone={tone}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium leading-5',
        classes.badge,
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', classes.dot)} />
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * Brings a one-time value into view and moves focus to it so keyboard and
 * screen-reader users notice it before it can be lost.
 */
export function revealOneTimeValue(container: ParentNode | null | undefined) {
  if (!container) return;
  const panel = container.querySelector<HTMLElement>('[data-one-time-code-panel]');
  if (!panel) return;
  const reduceMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // jsdom and some embedded browsers do not implement scrollIntoView.
  panel.scrollIntoView?.({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  const focusTarget = panel.querySelector<HTMLElement>('[data-one-time-code-focus]') ?? panel;
  focusTarget.focus({ preventScroll: true });
}
