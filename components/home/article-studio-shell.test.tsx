// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/sidebar', () => ({
  Sidebar: ({ children, collapsible, ...props }: React.ComponentProps<'aside'> & { collapsible?: string }) => (
    <aside data-collapsible-mode={collapsible} {...props}>{children}</aside>
  ),
  SidebarContent: ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  ),
  SidebarFooter: ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  ),
  SidebarInset: ({ children, ...props }: React.ComponentProps<'main'>) => (
    <main {...props}>{children}</main>
  ),
  SidebarProvider: ({ children, defaultOpen: _defaultOpen, ...props }: any) => (
    <div data-testid="sidebar-provider" {...props}>{children}</div>
  ),
  SidebarRail: () => <button type="button">Resize rail</button>,
  SidebarTrigger: ({ openLabel, closeLabel: _closeLabel, ...props }: React.ComponentProps<'button'> & { openLabel?: string; closeLabel?: string }) => (
    <button type="button" aria-label={openLabel} {...props}>Toggle rail</button>
  ),
}));

import { ArticleStudioShell } from './article-studio-shell';

describe('ArticleStudioShell', () => {
  it('renders one workspace landmark with a rail and an in-flow mobile sidebar trigger', () => {
    const { container } = render(
      <ArticleStudioShell
        mode="public"
        headerTitle="Article Studio"
        sidebar={<nav aria-label="Drafts">Local draft</nav>}
        sidebarFooter={<button type="button">Sign in</button>}
      >
        <section>Composer</section>
      </ArticleStudioShell>,
    );

    expect(container.querySelector('[data-article-studio-shell="public"]')).toBeTruthy();
    expect(container.querySelector('[data-article-studio-rail]')).toBeTruthy();
    expect(container.querySelector('[data-collapsible-mode="icon"]')).toBeTruthy();
    expect(container.querySelector('[data-article-studio-workspace]')).toBeTruthy();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByTestId('sidebar-provider')).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Drafts' })).toBeTruthy();
    expect(container.querySelector('.console-header')).toBeNull();
    expect(container.querySelector('[data-screen-line]')).toBeNull();
    const main = container.querySelector('[data-article-studio-main]');
    const trigger = container.querySelector('[data-article-studio-sidebar-trigger]');
    expect(main?.className).toContain('flex-col');
    expect(main?.className).not.toContain('pt-12');
    expect(main?.className).not.toContain('sm:pt-14');
    expect(trigger?.parentElement?.className).toContain('h-11');
    expect(container.querySelector('[data-article-studio-content]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open article navigation' })).toBeTruthy();
    expect(screen.getByText('Composer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    const sidebarFooter = screen.getByRole('button', { name: 'Sign in' }).parentElement;
    expect(sidebarFooter?.className).toContain('mt-auto');
    expect(sidebarFooter?.className).not.toContain('group-data-[collapsible=icon]:hidden');
  });
});
