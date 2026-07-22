// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Card } from './card';

describe('Card', () => {
  afterEach(() => cleanup());

  it('uses borders instead of decorative elevation', () => {
    render(<Card>Content</Card>);

    const card = screen.getByText('Content');
    expect(card.className).toContain('shadow-none');
    expect(card.className).not.toContain('shadow-sm');
  });
});
