// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import {
  parseComposerIllustrationStyle,
  parseComposerSlideCount,
  PromptComposer,
} from './prompt-composer';

describe('PromptComposer restored select values', () => {
  it('accepts only supported slide counts', () => {
    expect(parseComposerSlideCount('7')).toBe(7);
    expect(parseComposerSlideCount('')).toBeNull();
    expect(parseComposerSlideCount('0')).toBeNull();
    expect(parseComposerSlideCount('2')).toBeNull();
  });

  it('accepts only configured illustration styles', () => {
    expect(parseComposerIllustrationStyle('pixel-art')).toBe('pixel-art');
    expect(parseComposerIllustrationStyle('')).toBeNull();
    expect(parseComposerIllustrationStyle('unknown')).toBeNull();
  });

  it('uses the studio field and inline control treatment', () => {
    render(React.createElement(PromptComposer, {
        prompt: '',
        onPromptChange: () => undefined,
        slideCount: 5,
        onSlideCountChange: () => undefined,
        illustrationStyle: 'lab-notes',
        onIllustrationStyleChange: () => undefined,
        onGenerate: () => undefined,
        labels: {
          prompt: 'Article idea',
          placeholder: 'Describe the article',
          slideCount: 'Slides',
          illustrationStyle: 'Style',
          generate: 'Create article',
          generating: 'Creating article',
          styleNames: {
            'pixel-art': 'Pixel Art',
            'fantasy-animation': 'Fantasy Animation',
            'lab-notes': 'Lab Notes',
          },
        },
      }));

    expect(screen.getByRole('textbox').classList.contains('studio-prompt-input')).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Slides' }).classList.contains('studio-composer-chip')).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Style' }).classList.contains('studio-composer-chip')).toBe(true);
  });
});
