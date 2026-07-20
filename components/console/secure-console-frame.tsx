import type { ReactNode } from 'react';
import Link from 'next/link';
import { Layers3 } from 'lucide-react';

import { cn } from '@/lib/utils';

export type ConsoleFrameVariant = 'public' | 'checkpoint' | 'private' | 'focus';
export type ConsoleStatusTone = 'neutral' | 'action' | 'warning' | 'success' | 'danger';

export interface ConsoleStatusItem {
  label: string;
  value: string;
  tone?: ConsoleStatusTone;
}

const cornerPositions = [
  'left-[-5px] top-[-5px]',
  'right-[-5px] top-[-5px]',
  'bottom-[-5px] left-[-5px]',
  'bottom-[-5px] right-[-5px]',
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
            'pointer-events-none absolute size-2 border border-border bg-background',
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
      {corners ? <FrameCornerHandles className="size-2.5 bg-card" /> : null}
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
  className,
}: {
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  brandLabel?: string;
  className?: string;
}) {
  return (
    <header className={cn('console-header', className)}>
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
        <Link href="/" className="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
          <span className="inline-flex size-8 shrink-0 items-center justify-center border border-foreground/80 bg-foreground text-background">
            <Layers3 aria-hidden="true" className="size-4" />
          </span>
          <span className="truncate max-[350px]:hidden">{brandLabel}</span>
        </Link>
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
  contentClassName?: string;
  panelClassName?: string;
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
  contentClassName,
  panelClassName,
}: SecureConsoleFrameProps) {
  const shellWidth = variant === 'private' || variant === 'focus' ? 'max-w-7xl' : 'max-w-4xl';
  const contentWidth = variant === 'private' || variant === 'focus' ? 'max-w-none' : 'max-w-2xl';

  return (
    <main
      data-console-frame={variant}
      className={cn('console-viewport', className)}
    >
      <div aria-hidden="true" className="viewport-top-line" />
      <div
        className={cn(
          'console-shell',
          shellWidth,
          variant === 'private' || variant === 'focus' ? 'console-shell-private' : null,
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
      </div>
    </main>
  );
}
