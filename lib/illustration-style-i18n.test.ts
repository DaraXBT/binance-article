import { describe, expect, it } from 'vitest';

import { ILLUSTRATION_STYLE_IDS } from '@/lib/config';
import {
  getIllustrationStyleCopy,
  ILLUSTRATION_STYLE_COPY,
} from '@/lib/illustration-style-i18n';
import { LANGUAGES } from '@/lib/i18n';

describe('illustration style interface copy', () => {
  it('covers every supported style in every selectable language', () => {
    for (const { code } of LANGUAGES) {
      expect(Object.keys(ILLUSTRATION_STYLE_COPY[code]).sort())
        .toEqual([...ILLUSTRATION_STYLE_IDS].sort());

      for (const styleId of ILLUSTRATION_STYLE_IDS) {
        const copy = getIllustrationStyleCopy(code, styleId);
        expect(copy.name).not.toHaveLength(0);
        expect(copy.description).not.toHaveLength(0);
      }
    }
  });

  it('returns distinct localized labels and descriptions without changing style IDs', () => {
    const localizedPixelArtNames = LANGUAGES.map(({ code }) =>
      getIllustrationStyleCopy(code, 'pixel-art').name,
    );
    const localizedPixelArtDescriptions = LANGUAGES.map(({ code }) =>
      getIllustrationStyleCopy(code, 'pixel-art').description,
    );

    expect(new Set(localizedPixelArtNames)).toHaveLength(LANGUAGES.length);
    expect(new Set(localizedPixelArtDescriptions)).toHaveLength(LANGUAGES.length);
    expect(getIllustrationStyleCopy('km', 'binance-master').name)
      .toBe('Binance គ្រប់យ៉ាងក្នុងមួយ');
  });
});
