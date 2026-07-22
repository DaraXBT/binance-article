'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PanelLeftOpenIcon } from 'lucide-react';

import { BinanceMark } from '@/components/icons/binance-mark';
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

export function StudioSidebarBrand({
  href,
  label = 'xArticle',
  description,
  openLabel,
  closeLabel,
}: {
  href: string;
  label?: string;
  description?: string;
  openLabel: string;
  closeLabel: string;
}) {
  const { isMobile, state } = useSidebar();
  const isCollapsed = !isMobile && state === 'collapsed';
  const [showOpenControl, setShowOpenControl] = useState(false);

  useEffect(() => {
    if (!isCollapsed) setShowOpenControl(false);
  }, [isCollapsed]);

  if (isCollapsed) {
    return (
      <div data-studio-sidebar-brand className="flex size-8 items-center justify-center">
        <SidebarTrigger
          data-studio-sidebar-collapsed-control
          data-visual={showOpenControl ? 'open' : 'logo'}
          openLabel={openLabel}
          closeLabel={closeLabel}
          onPointerEnter={() => setShowOpenControl(true)}
          onPointerLeave={() => setShowOpenControl(false)}
          onFocus={() => setShowOpenControl(true)}
          onBlur={() => setShowOpenControl(false)}
          onClick={() => setShowOpenControl(false)}
          className={cn(
            'size-8 shrink-0 rounded-lg border shadow-none',
            showOpenControl
              ? 'border-sidebar-border/80 bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              : 'border-brand-binance-border bg-brand-binance text-brand-binance-foreground hover:bg-brand-binance hover:text-brand-binance-foreground',
          )}
        >
          {showOpenControl ? (
            <PanelLeftOpenIcon aria-hidden="true" className="size-4" />
          ) : (
            <BinanceMark aria-hidden="true" className="size-[1.05rem]" />
          )}
        </SidebarTrigger>
      </div>
    );
  }

  return (
    <div
      data-studio-sidebar-brand
      className="relative flex min-w-0 items-center gap-1"
    >
      <Link
        href={href}
        aria-label={label}
        title={label}
        className="flex min-w-0 flex-1 items-center gap-2.5 px-1 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50"
      >
        <span
          data-studio-sidebar-logo
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand-binance-border bg-brand-binance text-brand-binance-foreground"
        >
          <BinanceMark aria-hidden="true" className="size-[1.05rem]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
            {label}
          </span>
          {description ? (
            <span className="block truncate font-mono text-[0.58rem] uppercase tracking-[0.12em] text-sidebar-foreground/60">
              {description}
            </span>
          ) : null}
        </span>
      </Link>

      <SidebarTrigger
        data-studio-sidebar-brand-toggle
        openLabel={openLabel}
        closeLabel={closeLabel}
        onClick={(event) => {
          if (event.detail === 0) return;
          const trigger = event.currentTarget;
          window.requestAnimationFrame(() => trigger.blur());
        }}
        className="size-8 shrink-0 rounded-lg border border-sidebar-border/80 bg-sidebar text-sidebar-foreground shadow-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      />
    </div>
  );
}
