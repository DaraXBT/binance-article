// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { Button } from './button';

const materialVariants = [
  ['default', 'button-material-primary'],
  ['secondary', 'button-material-secondary'],
  ['outline', 'button-material-outline'],
  ['destructive', 'button-material-destructive'],
] as const;
const flatVariants = ['ghost', 'link'] as const;
const allVariants = [...materialVariants.map(([variant]) => variant), ...flatVariants] as const;

describe('Button material contract', () => {
  afterEach(() => cleanup());

  it.each(materialVariants)('renders the %s variant as its raised material', (variant, materialClass) => {
    render(<Button variant={variant}>{variant}</Button>);

    const button = screen.getByRole('button', { name: variant });
    expect(button.classList.contains('button-material')).toBe(true);
    expect(button.classList.contains(materialClass)).toBe(true);
    expect(button.classList.contains('button-flat')).toBe(false);
  });

  it.each(flatVariants)('keeps the %s variant on the shared flat treatment', (variant) => {
    render(<Button variant={variant}>{variant}</Button>);

    const button = screen.getByRole('button', { name: variant });
    expect(button.classList.contains('button-flat')).toBe(true);
    expect(button.classList.contains('button-material')).toBe(false);
  });

  it.each(allVariants)('uses the approved rounded-lg shape for the %s variant', (variant) => {
    render(<Button variant={variant}>{variant}</Button>);

    expect(screen.getByRole('button', { name: variant }).classList.contains('rounded-lg')).toBe(true);
  });

  it('centralizes the prompt-specific pill shape in the shared button variants', () => {
    render(<Button shape="pill">Prompt action</Button>);

    const button = screen.getByRole('button', { name: 'Prompt action' });
    expect(button.classList.contains('rounded-full')).toBe(true);
    expect(button.classList.contains('rounded-lg')).toBe(false);
  });

  it('shows a pointer for enabled actions and preserves a not-allowed cursor when disabled', () => {
    const { rerender } = render(<Button>Enabled</Button>);
    const enabled = screen.getByRole('button', { name: 'Enabled' });
    expect(enabled.classList.contains('cursor-pointer')).toBe(true);

    rerender(<Button disabled>Disabled</Button>);
    const disabled = screen.getByRole('button', { name: 'Disabled' });
    expect(disabled.classList.contains('disabled:cursor-not-allowed')).toBe(true);
  });

  it('defines theme-aware semantic tokens for material highlight, edge, and shadow', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');
    const rootTokens = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
    const darkTokens = css.match(/\.dark\s*\{([^}]*)\}/)?.[1] ?? '';

    for (const token of [
      '--button-material-highlight',
      '--button-material-edge',
      '--button-material-shadow',
      '--button-material-shadow-hover',
      '--button-material-shadow-pressed',
      '--button-primary-from',
      '--button-primary-to',
      '--button-primary-foreground',
      '--button-secondary-from',
      '--button-outline-from',
      '--button-destructive-from',
    ]) {
      expect(rootTokens).toContain(`${token}:`);
      expect(darkTokens).toContain(`${token}:`);
    }

    expect(rootTokens).toMatch(/--button-primary-from:\s*#44403c/i);
    expect(rootTokens).toMatch(/--button-primary-to:\s*#292524/i);
    expect(darkTokens).toMatch(/--button-primary-from:\s*#f8d33a/i);
    expect(darkTokens).toMatch(/--button-primary-to:\s*#f0b90b/i);
    expect(darkTokens).toMatch(/--button-primary-foreground:\s*#141413/i);
  });

  it('binds raised and flat treatments to stable global selectors', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');
    const materialRule = css.match(/\.button-material\s*\{([^}]*)\}/)?.[1] ?? '';
    const flatRule = css.match(/\.button-flat\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(materialRule).toContain('box-shadow:');
    expect(materialRule).toContain('var(--button-material-highlight)');
    expect(materialRule).toContain('var(--button-material-edge)');
    expect(materialRule).toContain('var(--button-material-shadow)');
    expect(flatRule).toMatch(/box-shadow:\s*none/);
  });

  it('keeps the bevel attached without a hard drop-shadow stripe', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');
    const rootTokens = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
    const darkTokens = css.match(/\.dark\s*\{([^}]*)\}/)?.[1] ?? '';

    for (const tokens of [rootTokens, darkTokens]) {
      const baseShadow = tokens.match(/--button-material-shadow:\s*([\s\S]*?);/)?.[1] ?? '';
      const hoverShadow = tokens.match(/--button-material-shadow-hover:\s*([\s\S]*?);/)?.[1] ?? '';
      const pressedShadow = tokens.match(/--button-material-shadow-pressed:\s*([\s\S]*?);/)?.[1] ?? '';

      expect(baseShadow).not.toMatch(/\b0\s+[23]px\s+0\b/);
      expect(hoverShadow).not.toMatch(/\b0\s+[23]px\s+0\b/);
      expect(pressedShadow).not.toMatch(/\b0\s+1px\s+0\b/);
    }

    expect(css).toContain('inset 0 -1px 0 var(--button-material-edge)');
    expect(css).not.toContain('inset 0 -2px 0 var(--button-material-edge)');
  });

  it('defines hover, pressed, disabled, and reduced-motion material states', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');

    expect(css).toContain('.button-material:not(:disabled):hover');
    expect(css).toContain('.button-material:not(:disabled):active');
    expect(css).toContain('.button-material:disabled');
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.button-material/);
  });

  it('gives native enabled controls a pointer cursor without overriding disabled or resize controls', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');

    expect(css).toMatch(/button:not\(:disabled\)[\s\S]*cursor:\s*pointer/);
    expect(css).toMatch(/select:not\(:disabled\)[\s\S]*cursor:\s*pointer/);
    expect(css).toContain("a[href]:not([disabled]):not([aria-disabled='true'])");
    expect(css).toContain("[role='menuitem']");
    expect(css).toContain("[role='slider']");
    expect(css).toContain("[role='button']");
    expect(css).toContain("[aria-disabled='true']");
    expect(css).toContain('[data-disabled]');
    expect(css).toContain("[data-state='disabled']");
    expect(css).toMatch(/}\s*\/\* Disabled affordances[\s\S]*cursor:\s*not-allowed/);
  });

  it('keeps hover and press states static and unanimated', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');

    expect(css).not.toContain('transform: translateY(-1px)');
    expect(css).not.toContain('transform: translateY(1px)');
    expect(css).toContain('transition: none !important');
  });
});
