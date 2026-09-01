import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatRelativeTime,
  translations,
  type Language,
} from './i18n';

const languages = ['en', 'km', 'id', 'lo', 'my', 'th', 'fil'] as const satisfies readonly Language[];
const nonEnglishLanguages = languages.filter((language) => language !== 'en');

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

  it.each(nonEnglishLanguages)(
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

  it.each(nonEnglishLanguages)(
    'does not fall back to English for reachable article styles and generation locks in %s',
    (language) => {
      const localized = translations[language].newDeck;
      const english = translations.en.newDeck;
      const styleKeys = Object.keys(english.styleOptions) as Array<keyof typeof english.styleOptions>;

      for (const styleKey of styleKeys) {
        expect(localized.styleOptions[styleKey].name).not.toBe(english.styleOptions[styleKey].name);
        expect(localized.styleOptions[styleKey].description).not.toBe(english.styleOptions[styleKey].description);
        expect(localized.styleOptions[styleKey].bestFor).not.toBe(english.styleOptions[styleKey].bestFor);
      }

      const promptKeys = [
        'title',
        'subtitle',
        'topicLabel',
        'topicPlaceholder',
        'promptLabel',
        'promptPlaceholder',
        'promptHintWithTopic',
        'promptHintEmpty',
        'generationLockedBanner',
        'generationLockedHint',
      ] as const;

      for (const key of promptKeys) {
        expect(localized.promptView[key]).not.toBe(english.promptView[key]);
      }

      expect(localized.generateView.generationLockedTitle)
        .not.toBe(english.generateView.generationLockedTitle);
      expect(localized.generateView.generationLockedDescription)
        .not.toBe(english.generateView.generationLockedDescription);
    },
  );

  it('keeps Indonesian and Filipino article-tab labels out of the English fallback catalog', () => {
    const id = translations.id;
    const fil = translations.fil;

    expect(id.deckPage.tabsEditor).not.toBe(translations.en.deckPage.tabsEditor);
    expect(id.slideList.slide(1)).not.toBe(translations.en.slideList.slide(1));
    expect(id.slideEditor.editSlide(1)).not.toBe(translations.en.slideEditor.editSlide(1));
    expect(id.slidePreview.slide(1)).not.toBe(translations.en.slidePreview.slide(1));
    expect(fil.deckPage.tabsEditor).not.toBe(translations.en.deckPage.tabsEditor);
    expect(fil.deckPage.tabsPreview).not.toBe(translations.en.deckPage.tabsPreview);
    expect(fil.slideList.slide(1)).not.toBe(translations.en.slideList.slide(1));
    expect(fil.slidePreview.slide(1)).not.toBe(translations.en.slidePreview.slide(1));
  });

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
