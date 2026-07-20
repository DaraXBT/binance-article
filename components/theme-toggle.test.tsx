// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const themeMock = vi.hoisted(() => ({
  resolvedTheme: 'light' as 'light' | 'dark' | undefined,
  setTheme: vi.fn(),
}));

vi.mock('next-themes', () => ({
  useTheme: () => themeMock,
}));

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({
    messages: {
      theme: {
        ariaLabel: 'Toggle theme',
        light: 'Light',
        dark: 'Dark',
        system: 'System',
      },
    },
  }),
}));

import { ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    themeMock.resolvedTheme = 'light';
    themeMock.setTheme.mockReset();
  });

  afterEach(() => cleanup());

  it('switches directly from light to dark without opening a menu', () => {
    const { container } = render(<ThemeToggle />);
    const toggle = screen.getByRole('button', { name: 'Toggle theme' });

    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('.lucide-sun')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(toggle);

    expect(themeMock.setTheme).toHaveBeenCalledWith('dark');
    expect(themeMock.setTheme).toHaveBeenCalledTimes(1);
  });

  it('switches directly from dark to light', () => {
    themeMock.resolvedTheme = 'dark';
    const { container } = render(<ThemeToggle />);
    const toggle = screen.getByRole('button', { name: 'Toggle theme' });

    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.lucide-moon')).toBeTruthy();

    fireEvent.click(toggle);

    expect(themeMock.setTheme).toHaveBeenCalledWith('light');
  });
});
