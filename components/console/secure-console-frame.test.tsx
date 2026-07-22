// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ConsoleHeader,
  FrameCornerHandles,
  SecureConsoleFrame,
} from './secure-console-frame';

describe('SecureConsoleFrame', () => {
  afterEach(() => cleanup());

  it('renders a framed console with truthful status values', () => {
    const { container } = render(
      <SecureConsoleFrame
        variant="public"
        eyebrow="ARTICLE STUDIO"
        title="Draft a publish-ready article"
        subtitle="One focused workspace for the next story."
        header={<div>Header</div>}
        statuses={[
          { label: 'Draft', value: 'LOCAL', tone: 'neutral' },
          { label: 'Identity', value: 'REQUIRED', tone: 'warning' },
        ]}
        footer={<span>Private workspace</span>}
      >
        <button type="button">Start</button>
      </SecureConsoleFrame>,
    );

    expect(screen.getByRole('main').getAttribute('data-console-frame')).toBe('public');
    expect(screen.getByRole('heading', { name: 'Draft a publish-ready article' })).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText('LOCAL')).toBeTruthy();
    expect(screen.getByText('Private workspace')).toBeTruthy();
    expect(container.querySelectorAll('[data-frame-corner]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-screen-line]')).toHaveLength(2);
    expect(container.querySelector('[data-console-panel]')?.className).toContain('border-dotted');
  });

  it('supports a compact checkpoint without requiring a title', () => {
    render(
      <SecureConsoleFrame variant="checkpoint" eyebrow="IDENTITY">
        <p>Continue with Google</p>
      </SecureConsoleFrame>,
    );

    expect(screen.getByRole('main').getAttribute('data-console-frame')).toBe('checkpoint');
    expect(screen.getByText('IDENTITY')).toBeTruthy();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('uses the Binance brand mark in compact console headers', () => {
    const { container } = render(<ConsoleHeader brandHref="/" brandLabel="xArticle" />);

    expect(container.querySelector('[data-binance-mark]')).toBeTruthy();
    expect(container.querySelector('.lucide-layers-3')).toBeNull();
  });

  it('centers standard-size corner handles on every panel corner', () => {
    const { container } = render(
      <div className="relative">
        <FrameCornerHandles />
      </div>,
    );

    const corners = Array.from(
      container.querySelectorAll<HTMLElement>('[data-frame-corner]'),
    );

    expect(corners).toHaveLength(4);
    for (const corner of corners) {
      expect(corner.className).toContain('size-4');
      expect(corner.className).toContain('rounded-[3px]');
      expect(corner.className).toContain('border-border');
      expect(corner.className).not.toContain('border-2');
    }
    expect(corners[0]?.className).toContain('-translate-x-1/2');
    expect(corners[0]?.className).toContain('-translate-y-1/2');
    expect(corners[3]?.className).toContain('translate-x-1/2');
    expect(corners[3]?.className).toContain('translate-y-1/2');
    expect(corners.some((corner) => corner.className.includes('[-5px]'))).toBe(false);
  });
});
