// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.ComponentProps<'a'>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({ messages: { common: { back: 'Back' } } }),
}));

vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => <button type="button" aria-label="Toggle theme">Theme</button>,
}));

vi.mock('@/components/ui/particles', () => ({
  Particles: ({
    className,
    color,
    ease,
    quantity,
  }: {
    className?: string;
    color?: string;
    ease?: number;
    quantity?: number;
  }) => (
    <div
      data-auth-particles="true"
      data-color={color}
      data-ease={ease}
      data-quantity={quantity}
      className={className}
    >
      <canvas aria-hidden="true" />
    </div>
  ),
}));

import { AuthPage } from './auth-page';

describe('AuthPage', () => {
  afterEach(() => cleanup());

  it('renders a flat xArticle login shell with essential utilities', () => {
    const { container } = render(
      <AuthPage>
        <div>Login content</div>
      </AuthPage>,
    );

    expect(container.querySelector('[data-auth-page="true"]')).toBeTruthy();
    expect(screen.getByRole('link', { name: /back/i }).getAttribute('href')).toBe('/');
    expect(screen.getByText('xArticle')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Switch language' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Toggle theme' })).toBeTruthy();
    expect(screen.getByText('Login content')).toBeTruthy();
    const particles = container.querySelector('[data-auth-particles="true"]');
    expect(particles?.getAttribute('data-color')).toBe('#666666');
    expect(particles?.getAttribute('data-ease')).toBe('20');
    expect(particles?.getAttribute('data-quantity')).toBe('120');
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  it('keeps the Efferd animation free of Efferd branding, GitHub, legal placeholders, gradients, and shadows', () => {
    const { container } = render(<AuthPage><div>Login content</div></AuthPage>);

    expect(screen.queryByText(/efferd/i)).toBeNull();
    expect(screen.queryByText(/github/i)).toBeNull();
    expect(screen.queryByText(/terms of service|privacy policy/i)).toBeNull();
    expect(container.innerHTML).not.toContain('gradient');
    expect(container.innerHTML).not.toContain('shadow-');
  });
});
