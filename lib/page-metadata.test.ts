import { describe, expect, it } from 'vitest';

import { metadataForLanguage } from './page-metadata';
import type { Language } from './i18n';

const languages = ['en', 'km', 'id', 'lo', 'my', 'th', 'fil'] as const satisfies readonly Language[];

describe('page metadata', () => {
  it.each(languages)('provides a title and description for %s', (language) => {
    const metadata = metadataForLanguage(language);

    expect(metadata.title).toBeTruthy();
    expect(metadata.description).toBeTruthy();
  });

  it.each(languages.filter((language) => language !== 'en'))(
    'does not reuse English browser metadata for %s',
    (language) => {
      const english = metadataForLanguage('en');
      const metadata = metadataForLanguage(language);

      expect(metadata.title).not.toBe(english.title);
      expect(metadata.description).not.toBe(english.description);
    },
  );
});
