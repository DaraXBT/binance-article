// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/sidebar', () => ({
  Sidebar: ({ children, ...props }: React.ComponentProps<'aside'>) => (
    <aside {...props}>{children}</aside>
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
  SidebarTrigger: () => <button type="button">Toggle rail</button>,
}));

import { ArticleStudioShell } from './article-studio-shell';

describe('ArticleStudioShell', () => {
  it('renders one workspace landmark with rail, header, content, and footer slots', () => {
    const { container } = render(
      <ArticleStudioShell
        mode="public"
        headerTitle="Article Studio"
        sidebar={<nav aria-label="Drafts">Local draft</nav>}
        sidebarFooter={<button type="button">Sign in</button>}
        headerActions={<button type="button">Theme</button>}
        footer={<span>Saved in this tab</span>}
      >
        <section>Composer</section>
      </ArticleStudioShell>,
    );

    expect(container.querySelector('[data-article-studio-shell="public"]')).toBeTruthy();
    expect(container.querySelector('[data-article-studio-rail]')).toBeTruthy();
    expect(container.querySelector('[data-article-studio-workspace]')).toBeTruthy();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByTestId('sidebar-provider')).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Drafts' })).toBeTruthy();
    expect(screen.getByText('Article Studio')).toBeTruthy();
    expect(screen.getByText('Composer')).toBeTruthy();
    expect(screen.getByText('Saved in this tab')).toBeTruthy();
  });
});
