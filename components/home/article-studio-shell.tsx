'use client';

import type { ReactNode } from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { ScreenLine } from '@/components/console/secure-console-frame';
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
  className?: string;
  mainClassName?: string;
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
          <Sidebar
            data-article-studio-rail
            aria-label={mode === 'public' ? 'Article navigation' : 'Article history'}
            className="z-30 border-r border-dotted border-sidebar-border/80 md:!absolute md:!inset-y-0"
            collapsible="offcanvas"
          >
            <SidebarContent className="min-h-0 px-2 py-2">
              {sidebar}
            </SidebarContent>
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
