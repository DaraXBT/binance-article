// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { Logo } from './logo';

describe('Logo', () => {
  afterEach(() => cleanup());

  it('keeps the xArticle wordmark and uses a Binance glyph', () => {
    const { container } = render(<Logo />);

    expect(screen.getByText('xArticle')).toBeTruthy();
    expect(container.querySelector('[data-binance-mark]')).toBeTruthy();
    expect(container.querySelector('[data-brand-mark]')?.classList.contains('bg-brand-binance')).toBe(true);
    expect(container.querySelector('.lucide-layers-3')).toBeNull();
  });

  it('defines semantic Binance brand colors', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');
    const rootTokens = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(rootTokens).toMatch(/--brand-binance:\s*#f0b90b/i);
    expect(rootTokens).toMatch(/--brand-binance-foreground:\s*#181a20/i);
    expect(rootTokens).toMatch(/--brand-binance-border:\s*#c99400/i);
  });

  it('uses Binance branding for the browser app icon', () => {
    const icon = readFileSync(resolve(process.cwd(), 'public/icon.svg'), 'utf8');

    expect(icon).toMatch(/fill=["']#F0B90B["']/i);
    expect(icon).toMatch(/fill=["']#181A20["']/i);
    expect(icon).toContain('16.624 13.92');
  });
});
