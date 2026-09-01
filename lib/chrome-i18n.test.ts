import { describe, expect, it } from 'vitest';

import {
  chromeInvitationErrorMessage,
  chromeTranslations,
  formatChromeDate,
  getChromeCopy,
} from './chrome-i18n';

describe('shared chrome translations', () => {
  it('keeps every shared chrome message available in all seven locales', () => {
    const englishKeys = Object.keys(chromeTranslations.en).sort();

    for (const [language, messages] of Object.entries(chromeTranslations)) {
      expect(Object.keys(messages).sort(), language).toEqual(englishKeys);
    }
  });

  it('returns localized chrome copy and locale-aware dates', () => {
    const english = getChromeCopy('en');
    const khmer = getChromeCopy('km');

    expect(khmer.t('close')).toBe('បិទ');
    expect(khmer.t('pagination')).not.toBe(english.t('pagination'));
    expect(formatChromeDate('km', '2026-08-31T00:00:00.000Z', khmer.t('notAvailable')))
      .not.toBe(formatChromeDate('en', '2026-08-31T00:00:00.000Z', english.t('notAvailable')));
  });

  it('uses Filipino labels for sidebar controls', () => {
    const filipino = getChromeCopy('fil');

    expect(filipino.t('sidebar')).toBe('Panel sa gilid');
    expect(filipino.t('openSidebar')).toBe('Buksan ang panel sa gilid');
    expect(filipino.t('closeSidebar')).toBe('Isara ang panel sa gilid');
    expect(filipino.t('toggleSidebar')).toBe('Ipakita o itago ang panel sa gilid');
  });

  it('uses safe localized recovery copy instead of raw invitation API errors', () => {
    const copy = getChromeCopy('th');
    const error = Object.assign(new Error('Raw upstream response'), {
      code: 'INVITATION_ALREADY_PENDING',
    });

    expect(chromeInvitationErrorMessage(error, copy, 'invitationCouldNotCreate'))
      .toBe(copy.t('invitationAlreadyPending'));
  });
});
