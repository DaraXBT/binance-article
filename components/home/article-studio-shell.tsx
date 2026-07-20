'use client';

import { useEffect, useRef } from 'react';
import type { ComponentProps, ReactNode } from 'react';

import {
  Sidebar,
  SidebarFooter,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  ScreenLine,
  type ConsoleStatusItem,
} from '@/components/console/secure-console-frame';
import { cn } from '@/lib/utils';

export type ArticleStudioMode = 'public' | 'workspace';

export interface ArticleStudioShellProps {
  mode: ArticleStudioMode;
  headerTitle: string;
  sidebar: ReactNode;
  sidebarFooter?: ReactNode;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  onMobileSidebarClose?: () => void;
  onMobileSidebarCloseAutoFocus?: ComponentProps<typeof Sidebar>['onMobileCloseAutoFocus'];
  className?: string;
  mainClassName?: string;
}

function MobileSidebarCloseBridge({ onClose }: { onClose?: () => void }) {
  const { openMobile } = useSidebar();
  const wasOpenRef = useRef(openMobile);

  useEffect(() => {
    if (wasOpenRef.current && !openMobile) onClose?.();
    wasOpenRef.current = openMobile;
  }, [onClose, openMobile]);

  return null;
}

const statusToneClasses: Record<NonNullable<ConsoleStatusItem['tone']>, string> = {
  neutral: 'text-muted-foreground',
  action: 'text-primary',
  warning: 'text-[var(--access-signal)]',
  success: 'text-emerald-600 dark:text-emerald-300',
  danger: 'text-destructive',
};

export function ArticleStudioStatusStrip({
  items,
  className,
}: {
  items: ConsoleStatusItem[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <dl
      data-article-studio-status-strip
      data-article-studio-status
      data-console-status-rail
      className={cn(
        'flex min-w-0 flex-wrap items-center border-y border-border/70 bg-background/25',
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={`${item.label}-${item.value}`}
          className="flex min-w-0 flex-1 basis-[30%] items-center justify-between gap-2 border-border/60 px-2.5 py-2 first:border-l-0 max-[500px]:flex-col max-[500px]:items-start max-[500px]:gap-0.5 max-[500px]:px-2 sm:px-3"
        >
          <dt className="truncate font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted-foreground/75">
            {item.label}
          </dt>
          <dd
            className={cn(
              'truncate font-mono text-[0.64rem] font-semibold uppercase tracking-[0.08em]',
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

/**
 * The shared compose-first shell for anonymous and authenticated article work.
 * It owns one sidebar provider and one main landmark; feature controllers own
 * draft, workspace, and generation state around it.
 */
export function ArticleStudioShell({
  mode,
  headerTitle,
  sidebar,
  sidebarFooter,
  headerActions,
  footer,
  children,
  onMobileSidebarClose,
  onMobileSidebarCloseAutoFocus,
  className,
  mainClassName,
}: ArticleStudioShellProps) {
  return (
    <div
      data-article-studio-shell={mode}
      data-console-frame={mode === 'public' ? 'public' : 'private'}
      className={cn('console-viewport', className)}
    >
      <div aria-hidden="true" className="viewport-top-line" />
      <div
        className={cn(
          'console-shell console-shell-studio mx-auto max-w-7xl',
          mode === 'workspace' ? 'console-shell-private' : null,
        )}
      >
        <SidebarProvider
          defaultOpen
          className="relative min-h-0 h-full w-full flex-1 bg-background"
        >
          {onMobileSidebarClose ? <MobileSidebarCloseBridge onClose={onMobileSidebarClose} /> : null}
          <Sidebar
            data-article-studio-rail={mode === 'public' ? 'anonymous' : 'workspace'}
            aria-label={mode === 'public' ? 'Article navigation' : 'Article history'}
            {...(onMobileSidebarCloseAutoFocus
              ? { onMobileCloseAutoFocus: onMobileSidebarCloseAutoFocus }
              : {})}
            className="z-30 border-r border-dotted border-sidebar-border/80 md:!absolute md:!inset-y-0"
            collapsible="offcanvas"
          >
            {sidebar}
            {sidebarFooter ? (
              <SidebarFooter className="border-t border-dotted border-sidebar-border/80">
                {sidebarFooter}
              </SidebarFooter>
            ) : null}
            <SidebarRail />
          </Sidebar>

          <SidebarInset
            data-article-studio-workspace
            aria-label={headerTitle}
            className="min-h-0 bg-background"
          >
            <header className="console-header studio-topbar sticky top-0 z-10 border-b border-dotted border-border/80 bg-background">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <SidebarTrigger className="size-8 rounded-none border border-border/70" />
                <p className="truncate font-mono text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-foreground sm:text-xs">
                  {headerTitle}
                </p>
              </div>
              {headerActions ? (
                <div className="ml-auto flex min-w-0 items-center gap-1.5">
                  {headerActions}
                </div>
              ) : null}
            </header>
            <ScreenLine className="h-3 sm:h-4" />

            <div
              data-article-studio-main
              className={cn(
                'min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-8 sm:py-6',
                mainClassName,
              )}
            >
              {children}
            </div>

            {footer ? (
              <>
                <ScreenLine className="h-3 sm:h-4" />
                <footer className="console-footer border-t-0">{footer}</footer>
              </>
            ) : null}
          </SidebarInset>
        </SidebarProvider>
      </div>
    </div>
  );
}
