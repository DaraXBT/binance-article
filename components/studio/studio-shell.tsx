import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type StudioSurface =
  | 'public'
  | 'workspace'
  | 'editor'
  | 'wizard'
  | 'checkpoint'
  | 'settings';

export interface StudioShellProps {
  surface: StudioSurface;
  frameVariant?: 'public' | 'checkpoint' | 'private' | 'focus';
  as?: 'main' | 'div';
  className?: string;
  shellClassName?: string;
  children: ReactNode;
}

/**
 * Shared viewport frame used by every user-facing studio surface. Feature
 * shells own their internal navigation while this component guarantees one
 * consistent outer rule, bounded canvas, and data contract for visual tests.
 */
export function StudioShell({
  surface,
  frameVariant = surface === 'public'
    ? 'public'
    : surface === 'checkpoint' || surface === 'settings'
      ? 'checkpoint'
      : surface === 'workspace'
        ? 'private'
        : 'focus',
  as: Component = 'main',
  className,
  shellClassName,
  children,
}: StudioShellProps) {
  return (
    <Component
      data-studio-surface={surface}
      data-console-frame={frameVariant}
      className={cn('console-viewport', className)}
    >
      <div aria-hidden="true" className="viewport-top-line" />
      <div className={cn('console-shell mx-auto', shellClassName)}>
        {children}
      </div>
    </Component>
  );
}
