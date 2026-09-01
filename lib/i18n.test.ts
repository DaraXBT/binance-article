import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatRelativeTime,
  translations,
  type Language,
} from './i18n';

const languages = ['en', 'km', 'id', 'lo', 'my', 'th', 'fil'] as const satisfies readonly Language[];

function nestedKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return nestedValue !== null && typeof nestedValue === 'object'
      ? [path, ...nestedKeys(nestedValue, path)]
      : [path];
  }).sort();
}

describe('application translations', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps every locale on the same typed message contract', () => {
    const englishKeys = nestedKeys(translations.en);

    for (const language of languages) {
      expect(nestedKeys(translations[language])).toEqual(englishKeys);
    }
  });

  it.each(languages.filter((language) => language !== 'en'))(
    'has localized public, auth, and workspace chrome for %s',
    (language) => {
      const messages = translations[language];

      const localizedRouteCopy: Array<[string, string]> = [
        [messages.auth.signInTitle, translations.en.auth.signInTitle],
        [messages.auth.joinCodeLabel, translations.en.auth.joinCodeLabel],
        [messages.auth.accountAccessLabel, translations.en.auth.accountAccessLabel],
        [messages.publicHome.studioTitle, translations.en.publicHome.studioTitle],
        [messages.publicHome.studioGreeting, translations.en.publicHome.studioGreeting],
        [messages.publicHome.openArticleNavigation, translations.en.publicHome.openArticleNavigation],
        [messages.dashboard.headerTitle, translations.en.dashboard.headerTitle],
        [messages.dashboard.promptHomeTitle, translations.en.dashboard.promptHomeTitle],
        [messages.dashboard.checkingAccount, translations.en.dashboard.checkingAccount],
        [messages.workspace.bootstrapLoadingTitle, translations.en.workspace.bootstrapLoadingTitle],
      ];

      for (const [localized, english] of localizedRouteCopy) {
        expect(localized).not.toBe(english);
      }
    },
  );

  it('uses native date-fns locales where available and platform locale formatting otherwise', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    const twoMinutesAgo = new Date('2026-08-31T23:58:00.000Z');

    expect(formatRelativeTime(twoMinutesAgo, 'id')).not.toContain('ago');
    expect(formatRelativeTime(twoMinutesAgo, 'th')).not.toContain('ago');
    expect(formatRelativeTime(twoMinutesAgo, 'lo')).toBe(
      new Intl.RelativeTimeFormat('lo', { numeric: 'auto' }).format(-2, 'minute'),
    );
    expect(formatRelativeTime(twoMinutesAgo, 'my')).toBe(
      new Intl.RelativeTimeFormat('my', { numeric: 'auto' }).format(-2, 'minute'),
    );
    expect(formatRelativeTime(twoMinutesAgo, 'fil')).toBe(
      new Intl.RelativeTimeFormat('fil', { numeric: 'auto' }).format(-2, 'minute'),
    );
  });
});
