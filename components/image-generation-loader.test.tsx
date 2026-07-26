// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const themeMock = vi.hoisted(() => ({
  resolvedTheme: 'light' as 'light' | 'dark' | undefined,
}));

vi.mock('next-themes', () => ({
  useTheme: () => themeMock,
}));

vi.mock('@/components/ui/dot-grid-spotlight', () => ({
  DotGridSpotlight: ({
    activeDotColor,
    className,
    dotColor,
    motion,
  }: {
    activeDotColor?: string;
    className?: string;
    dotColor?: string;
    motion?: string;
  }) => (
    <canvas
      data-testid="dot-grid"
      data-active-dot-color={activeDotColor}
      data-dot-color={dotColor}
      data-motion={motion}
      className={className}
    />
  ),
}));

import { ImageGenerationLoader } from './image-generation-loader';

describe('ImageGenerationLoader', () => {
  beforeEach(() => {
    themeMock.resolvedTheme = 'light';
  });

  afterEach(() => cleanup());

  it('renders a stable, accessible loading status with the light palette', () => {
    render(
      <ImageGenerationLoader
        label="Generating images"
        detail="2 of 5 complete"
      />,
    );

    const status = screen.getByRole('status');
    const grid = screen.getByTestId('dot-grid');

    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(status.getAttribute('data-size')).toBe('default');
    expect(status.classList.contains('relative')).toBe(true);
    expect(status.classList.contains('min-h-48')).toBe(true);
    expect(screen.getByText('Generating images')).toBeTruthy();
    expect(screen.getByText('2 of 5 complete')).toBeTruthy();
    expect(grid.getAttribute('data-dot-color')).toBe('rgba(49, 94, 246, 0.12)');
    expect(grid.getAttribute('data-active-dot-color')).toBe('rgba(49, 94, 246, 0.72)');
    expect(grid.getAttribute('data-motion')).toBe('auto-pointer');
  });

  it('uses the dark lime palette and compact dimensions', () => {
    themeMock.resolvedTheme = 'dark';

    render(
      <ImageGenerationLoader
        label="Regenerating slide"
        size="compact"
        className="aspect-video custom-loader"
      />,
    );

    const status = screen.getByRole('status');
    const grid = screen.getByTestId('dot-grid');

    expect(status.getAttribute('data-size')).toBe('compact');
    expect(status.classList.contains('min-h-28')).toBe(true);
    expect(status.classList.contains('min-h-48')).toBe(false);
    expect(status.classList.contains('aspect-video')).toBe(true);
    expect(status.classList.contains('custom-loader')).toBe(true);
    expect(grid.getAttribute('data-dot-color')).toBe('rgba(200, 252, 52, 0.10)');
    expect(grid.getAttribute('data-active-dot-color')).toBe('rgba(200, 252, 52, 0.72)');
  });

  it('waits for next-themes to resolve before painting a palette', () => {
    themeMock.resolvedTheme = undefined;
    const { rerender } = render(
      <ImageGenerationLoader label="Generating cover" />,
    );

    expect(screen.queryByTestId('dot-grid')).toBeNull();
    expect(screen.getByText('Generating cover')).toBeTruthy();

    themeMock.resolvedTheme = 'dark';
    rerender(<ImageGenerationLoader label="Generating cover" />);

    expect(screen.getByTestId('dot-grid').getAttribute('data-active-dot-color'))
      .toBe('rgba(200, 252, 52, 0.72)');
  });

  it('dims an optional backdrop and hides it from the status announcement', () => {
    render(
      <ImageGenerationLoader
        label="Regenerating cover"
        backdrop={<img src="/cover.png" alt="Existing cover" />}
      />,
    );

    const status = screen.getByRole('status');
    const image = screen.getByAltText('Existing cover');
    const backdrop = image.parentElement;

    expect(status.getAttribute('data-has-backdrop')).toBe('true');
    expect(backdrop?.getAttribute('aria-hidden')).toBe('true');
    expect(backdrop?.classList.contains('opacity-30')).toBe(true);
    expect(screen.queryByRole('img', { name: 'Existing cover' })).toBeNull();
  });
});
