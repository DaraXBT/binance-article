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
import { useLanguage } from '@/components/language-provider';
import { StudioShell } from '@/components/studio/studio-shell';
import { cn } from '@/lib/utils';

export type ArticleStudioMode = 'public' | 'workspace';

export interface ArticleStudioShellProps {
  mode: ArticleStudioMode;
  headerTitle: string;
  sidebar: ReactNode;
  sidebarFooter?: ReactNode;
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
  children,
  onMobileSidebarClose,
  onMobileSidebarCloseAutoFocus,
  className,
  mainClassName,
}: ArticleStudioShellProps) {
  const { messages } = useLanguage();
  const isPublic = mode === 'public';
  const sidebarLabel = isPublic
    ? messages.publicHome.studioTitle
    : messages.dashboard.workspaceDashboard;
  const openSidebarLabel = isPublic
    ? messages.publicHome.openArticleNavigation
    : messages.dashboard.openArticleHistory;
  const closeSidebarLabel = isPublic
    ? messages.publicHome.closeArticleNavigation
    : messages.dashboard.closeArticleHistory;

  return (
    <StudioShell
      as="div"
      surface={mode}
      frameVariant={mode === 'public' ? 'public' : 'private'}
      className={cn('studio-compose-viewport', className)}
      shellClassName={cn(
        // The compose surface is intentionally full-bleed. The rail owns the
        // only fixed-width column; the writing area should use the remaining
        // viewport instead of stopping inside a centered max-width shell.
        'console-shell-studio max-w-none',
        mode === 'workspace' ? 'console-shell-private' : null,
      )}
    >
      <div
        data-article-studio-shell={mode}
        className="relative flex min-h-0 w-full flex-1"
      >
        <SidebarProvider
          defaultOpen
          className="relative min-h-0 h-full w-full flex-1 bg-background"
        >
          {onMobileSidebarClose ? <MobileSidebarCloseBridge onClose={onMobileSidebarClose} /> : null}
          <Sidebar
            data-article-studio-rail={mode === 'public' ? 'anonymous' : 'workspace'}
            aria-label={sidebarLabel}
            {...(onMobileSidebarCloseAutoFocus
              ? { onMobileCloseAutoFocus: onMobileSidebarCloseAutoFocus }
              : {})}
            className="z-30 border-r border-sidebar-border/80 md:!absolute md:!inset-y-0"
            collapsible="icon"
          >
            {sidebar}
            {sidebarFooter ? (
              <SidebarFooter className="mt-auto border-t border-sidebar-border/80 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:border-t-0 group-data-[collapsible=icon]:px-2">
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
            <div
              data-article-studio-main
              className={cn(
                'min-h-0 flex flex-1 flex-col overflow-y-auto px-4 sm:px-6 lg:px-8',
                mode === 'public'
                  ? 'pb-8 sm:pb-12 lg:pb-16'
                  : 'pb-6 sm:pb-10 lg:pb-12',
                mainClassName,
              )}
            >
              <div className="flex h-11 shrink-0 items-center md:hidden">
                <SidebarTrigger
                  data-article-studio-sidebar-trigger
                  openLabel={openSidebarLabel}
                  closeLabel={closeSidebarLabel}
                  className="size-11 rounded-lg border border-border/70 bg-background/95 shadow-none"
                />
              </div>
              <div data-article-studio-content className="min-h-0 flex-1">
                {children}
              </div>
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </StudioShell>
  );
}
