import type { ReactNode } from 'react';
import Link from 'next/link';

import { BinanceMark } from '@/components/icons/binance-mark';
import { StudioShell, type StudioSurface } from '@/components/studio/studio-shell';
import { cn } from '@/lib/utils';

export type ConsoleFrameVariant = 'public' | 'checkpoint' | 'private' | 'focus';
export type ConsoleStatusTone = 'neutral' | 'action' | 'warning' | 'success' | 'danger';

export interface ConsoleStatusItem {
  label: string;
  value: string;
  tone?: ConsoleStatusTone;
}

const cornerPositions = [
  'left-0 top-0 -translate-x-1/2 -translate-y-1/2',
  'right-0 top-0 translate-x-1/2 -translate-y-1/2',
  'bottom-0 left-0 -translate-x-1/2 translate-y-1/2',
  'bottom-0 right-0 translate-x-1/2 translate-y-1/2',
] as const;

const statusToneClasses: Record<ConsoleStatusTone, string> = {
  neutral: 'text-muted-foreground',
  action: 'text-primary',
  warning: 'text-[var(--access-signal)]',
  success: 'text-emerald-600 dark:text-emerald-300',
  danger: 'text-destructive',
};

export function FrameCornerHandles({ className }: { className?: string }) {
  return (
    <>
      {cornerPositions.map((position) => (
        <span
          key={position}
          aria-hidden="true"
          data-frame-corner
          className={cn(
            'pointer-events-none absolute z-10 size-4 rounded-[3px] border border-border bg-card',
            position,
            className,
          )}
        />
      ))}
    </>
  );
}

export function ScreenLine({ className }: { className?: string }) {
  return <div aria-hidden="true" data-screen-line className={cn('screen-line', className)} />;
}

export function ConsolePanel({
  children,
  className,
  corners = true,
  as: Component = 'section',
}: {
  children: ReactNode;
  className?: string;
  corners?: boolean;
  as?: 'div' | 'section' | 'article';
}) {
  return (
    <Component data-console-panel className={cn('console-panel border-dotted', className)}>
      {corners ? <FrameCornerHandles /> : null}
      {children}
    </Component>
  );
}

export function ConsoleStatusRail({
  items,
  className,
}: {
  items: ConsoleStatusItem[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <dl
      data-console-status-rail
      className={cn(
        'grid min-w-0 grid-cols-2 border-y border-border/70 bg-background/25 max-[390px]:grid-cols-4 sm:grid-cols-4',
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={`${item.label}-${item.value}`}
          className="min-w-0 border-border/60 px-2.5 py-2 first:border-l-0 max-[390px]:border-l max-[390px]:px-1.5 max-[390px]:py-1.5 sm:border-l sm:px-3"
        >
          <dt className="truncate font-mono text-[0.625rem] uppercase tracking-[0.12em] text-muted-foreground/75 max-[390px]:text-[0.5rem] max-[390px]:tracking-[0.08em]">
            {item.label}
          </dt>
          <dd
            className={cn(
              'mt-0.5 truncate font-mono text-[0.68rem] font-semibold uppercase tracking-[0.08em] max-[390px]:text-[0.56rem] max-[390px]:tracking-[0.04em]',
              statusToneClasses[item.tone ?? 'neutral'],
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ConsoleHeader({
  actions,
  backHref,
  backLabel,
  brandLabel = 'xArticle',
  brandHref = '/',
  contextLabel,
  className,
}: {
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  brandLabel?: string;
  brandHref?: string;
  contextLabel?: string;
  className?: string;
}) {
  return (
    <header className={cn('console-header studio-console-header', className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {backHref ? (
          <Link
            href={backHref}
            aria-label={backLabel}
            className="mr-1 inline-flex size-8 shrink-0 items-center justify-center border border-border/70 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
          >
            <span aria-hidden="true">←</span>
          </Link>
        ) : null}
        <Link href={brandHref} className="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand-binance-border bg-brand-binance text-brand-binance-foreground">
            <BinanceMark aria-hidden="true" className="size-[1.05rem]" />
          </span>
          <span className="truncate max-[350px]:hidden">{brandLabel}</span>
        </Link>
        {contextLabel ? (
          <>
            <span aria-hidden="true" className="hidden h-4 border-l border-border/80 sm:block" />
            <span className="hidden truncate font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:block">
              {contextLabel}
            </span>
          </>
        ) : null}
      </div>
      {actions ? <div className="ml-auto flex min-w-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

export interface SecureConsoleFrameProps {
  variant: ConsoleFrameVariant;
  children: ReactNode;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  statuses?: ConsoleStatusItem[];
  header?: ReactNode;
  footer?: ReactNode;
  panel?: boolean;
  className?: string;
  shellClassName?: string;
  contentClassName?: string;
  panelClassName?: string;
  surface?: StudioSurface;
}

export function SecureConsoleFrame({
  variant,
  children,
  eyebrow,
  title,
  subtitle,
  statuses,
  header,
  footer,
  panel = true,
  className,
  shellClassName,
  contentClassName,
  panelClassName,
  surface,
}: SecureConsoleFrameProps) {
  const shellWidth = variant === 'private' || variant === 'focus' ? 'max-w-7xl' : 'max-w-4xl';
  const contentWidth = variant === 'private' || variant === 'focus' ? 'max-w-none' : 'max-w-2xl';
  const resolvedSurface: StudioSurface = surface ?? (
    variant === 'public'
      ? 'public'
      : variant === 'private'
        ? 'workspace'
        : variant === 'focus'
          ? 'editor'
          : 'checkpoint'
  );

  return (
    <StudioShell
      surface={resolvedSurface}
      frameVariant={variant}
      className={className}
      shellClassName={cn(
        shellWidth,
        variant === 'private' || variant === 'focus' ? 'console-shell-private' : null,
        shellClassName,
      )}
    >
        {header}
        {header ? <ScreenLine /> : null}
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-4 max-[390px]:px-3 max-[390px]:py-2 sm:px-6 sm:py-5', contentClassName)}>
          <div className={cn('mx-auto flex min-h-0 w-full flex-col gap-4 max-[390px]:gap-2', contentWidth)}>
            {eyebrow || title || subtitle ? (
              <div className="min-w-0">
                {eyebrow ? (
                  <p className="mb-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-primary">
                    {eyebrow}
                  </p>
                ) : null}
                {title ? (
                  <h1 className="text-2xl font-semibold leading-tight tracking-normal sm:text-3xl">
                    {title}
                  </h1>
                ) : null}
                {subtitle ? (
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                    {subtitle}
                  </p>
                ) : null}
              </div>
            ) : null}
            {statuses ? <ConsoleStatusRail items={statuses} /> : null}
            {panel ? <ConsolePanel className={panelClassName}>{children}</ConsolePanel> : children}
          </div>
        </div>
        {footer ? (
          <>
            <ScreenLine />
            <footer className="console-footer">{footer}</footer>
          </>
        ) : null}
    </StudioShell>
  );
}
