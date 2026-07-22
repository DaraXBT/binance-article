// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StudioShell } from './studio-shell';

describe('StudioShell', () => {
  it('renders a single accessible frame for standalone surfaces', () => {
    const { container } = render(
      <StudioShell surface="checkpoint">
        <p>Checkpoint content</p>
      </StudioShell>,
    );

    expect(screen.getByRole('main')).toBeTruthy();
    expect(container.querySelector('[data-studio-surface="checkpoint"]')).toBeTruthy();
    expect(container.querySelector('[data-console-frame="checkpoint"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-screen-line]').length).toBe(0);
    expect(screen.getByText('Checkpoint content')).toBeTruthy();
  });

  it('supports an embedded surface without introducing a nested main landmark', () => {
    const { container } = render(
      <StudioShell surface="workspace" as="div">
        <main aria-label="Workspace content">Workspace content</main>
      </StudioShell>,
    );

    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('[data-studio-surface="workspace"]')?.tagName).toBe('DIV');
  });
});
