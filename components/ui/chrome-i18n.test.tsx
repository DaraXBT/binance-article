// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider, useLanguage } from '@/components/language-provider';
import {
  Breadcrumb,
  BreadcrumbEllipsis,
} from '@/components/ui/breadcrumb';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Pagination,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { SidebarProvider, SidebarRail, SidebarTrigger } from '@/components/ui/sidebar';
import { Spinner } from '@/components/ui/spinner';

function ChromeFixture() {
  const { setLanguage } = useLanguage();

  return (
    <>
      <button type="button" onClick={() => setLanguage('km')}>Switch language</button>
      <Spinner />
      <Pagination />
      <PaginationPrevious href="#previous" />
      <PaginationNext href="#next" />
      <Breadcrumb><BreadcrumbEllipsis /></Breadcrumb>
      <Dialog open onOpenChange={() => undefined}>
        <DialogContent>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
        </DialogContent>
      </Dialog>
      <Sheet open onOpenChange={() => undefined}>
        <SheetContent>
          <SheetTitle>Sheet title</SheetTitle>
          <SheetDescription>Sheet description</SheetDescription>
        </SheetContent>
      </Sheet>
      <SidebarProvider>
        <SidebarTrigger />
        <SidebarRail />
      </SidebarProvider>
    </>
  );
}

describe('shared chrome locale behavior', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        addEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: '',
        onchange: null,
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.cookie = 'xarticle_language=; Max-Age=0; path=/';
    document.documentElement.lang = 'en';
  });

  it('updates shared controls and accessibility labels immediately after a language switch', () => {
    render(
      <LanguageProvider initialLanguage="en">
        <ChromeFixture />
      </LanguageProvider>,
    );

    expect(screen.getByRole('status', { name: 'Loading', hidden: true })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Pagination', hidden: true })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to previous page', hidden: true })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Close', hidden: true })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Close sidebar', hidden: true })).toBeTruthy();

    fireEvent.click(screen.getByText('Switch language'));

    expect(screen.getByRole('status', { name: 'កំពុងផ្ទុក', hidden: true })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'ការបែងចែកទំព័រ', hidden: true })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ទៅទំព័រមុន', hidden: true })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'បិទ', hidden: true })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'បិទរបារចំហៀង', hidden: true })).toBeTruthy();
    expect(screen.getByTitle('បិទ/បើករបារចំហៀង')).toBeTruthy();
  });
});
