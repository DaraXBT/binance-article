// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Particles } from './particles';

const context = {
  arc: vi.fn(),
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  fill: vi.fn(),
  fillStyle: '',
  scale: vi.fn(),
  setTransform: vi.fn(),
  translate: vi.fn(),
};

describe('Particles', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the Efferd canvas but does not animate when reduced motion is requested', () => {
    const { container } = render(<Particles quantity={12} />);

    expect(container.querySelector('canvas')).toBeTruthy();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
