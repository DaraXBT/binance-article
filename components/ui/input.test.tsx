// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from './input';
import { Textarea } from './textarea';

describe('form field shape', () => {
  it('gives standard inputs and textareas the shared rounded control shape', () => {
    render(<><Input aria-label="Name" /><Textarea aria-label="Notes" /></>);

    expect(screen.getByRole('textbox', { name: 'Name' }).className).toContain('rounded-lg');
    expect(screen.getByRole('textbox', { name: 'Notes' }).className).toContain('rounded-lg');
  });
});
