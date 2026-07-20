// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  parseComposerIllustrationStyle,
  parseComposerSlideCount,
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
});
