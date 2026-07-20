// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SecureConsoleFrame } from './secure-console-frame';

describe('SecureConsoleFrame', () => {
  afterEach(() => cleanup());

  it('renders a framed console with truthful status values', () => {
    const { container } = render(
      <SecureConsoleFrame
        variant="public"
        eyebrow="ARTICLE STUDIO"
        title="Draft a publish-ready article"
        subtitle="One focused workspace for the next story."
        statuses={[
          { label: 'Draft', value: 'LOCAL', tone: 'neutral' },
          { label: 'Identity', value: 'REQUIRED', tone: 'warning' },
        ]}
        footer={<span>Private workspace</span>}
      >
        <button type="button">Start</button>
      </SecureConsoleFrame>,
    );

    expect(screen.getByRole('main')).toHaveAttribute('data-console-frame', 'public');
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

    expect(screen.getByRole('main')).toHaveAttribute('data-console-frame', 'checkpoint');
    expect(screen.getByText('IDENTITY')).toBeTruthy();
    expect(screen.queryByRole('heading')).toBeNull();
  });
});
